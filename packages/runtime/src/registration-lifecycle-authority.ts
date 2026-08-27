import type { RegistrationResult } from "./registration-runtime.js";

interface AvailabilityState {
  readonly enabled: boolean;
  readonly ready: boolean;
}

interface LifecycleScope {
  readonly availability: ReadonlyMap<string, AvailabilityState>;
  readonly unavailablePlugins: ReadonlySet<string>;
}

export interface RegistrationLifecycleAuthority {
  readonly requiredProviders: ReadonlyMap<string, ReadonlySet<string>>;
  lifecycleParticipants: ReadonlySet<string>;
  registrationOpen: boolean;
  scope: LifecycleScope | undefined;
}

const authorities = new WeakMap<object, RegistrationLifecycleAuthority>();

export function createRegistrationLifecycleAuthority(requiredProviders: ReadonlyMap<string, ReadonlySet<string>>): RegistrationLifecycleAuthority {
  const lifecycleParticipants = new Set<string>();
  for (const [consumerId, providers] of requiredProviders) {
    if (providers.size === 0) continue;
    lifecycleParticipants.add(consumerId);
    for (const providerId of providers) lifecycleParticipants.add(providerId);
  }
  return { requiredProviders, lifecycleParticipants, registrationOpen: true, scope: undefined };
}

export function freezeRegistrationLifecycleAuthority(authority: RegistrationLifecycleAuthority): void {
  authority.registrationOpen = false;
}

export function retainRegistrationLifecycleAuthority(
  registration: RegistrationResult,
  authority: RegistrationLifecycleAuthority,
  lifecycleParticipants: ReadonlySet<string>
): void {
  authority.lifecycleParticipants = new Set([...authority.lifecycleParticipants, ...lifecycleParticipants]);
  authorities.set(registration, authority);
}

export function registrationLifecycleAuthority(registration: RegistrationResult): RegistrationLifecycleAuthority | undefined {
  return authorities.get(registration);
}

export function scopeRegistrationLifecycleAuthority(
  registration: RegistrationResult,
  availability: ReadonlyMap<string, AvailabilityState>,
  unavailablePlugins: ReadonlySet<string>
): void {
  const authority = authorities.get(registration);
  if (authority) authority.scope = { availability, unavailablePlugins };
}

function unavailable(authority: RegistrationLifecycleAuthority, pluginId: string): boolean {
  if (!authority.registrationOpen && authority.scope === undefined) return true;
  if (authority.scope === undefined) return false;
  if (authority.scope.unavailablePlugins.has(pluginId)) return true;
  if (!authority.lifecycleParticipants.has(pluginId)) return false;
  const availability = authority.scope.availability.get(pluginId);
  return availability === undefined || !availability.enabled || !availability.ready;
}

function leaseService<T>(service: T, authority: RegistrationLifecycleAuthority, consumerId: string, providerId: string): T {
  if ((typeof service !== "object" || service === null) && typeof service !== "function") return service;

  const wrapped = new WeakMap<object, object>();
  const rawByFacade = new WeakMap<object, object>();
  const assertAvailable = (): void => {
    if (!authority.registrationOpen && authority.scope === undefined) {
      throw new Error("Capability service requires authoritative lifecycle scoping.");
    }
    if (unavailable(authority, consumerId) || unavailable(authority, providerId)) {
      throw new Error(`Capability service is unavailable for ${consumerId}.`);
    }
  };
  const unwrap = (value: unknown): unknown => typeof value === "object" && value !== null || typeof value === "function"
    ? rawByFacade.get(value as object) ?? value
    : value;
  const wrap = (value: unknown, receiver?: { readonly raw: object; readonly facade: object }): unknown => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
    const raw = value as object;
    const known = wrapped.get(raw);
    if (known) return known;

    const callable = typeof value === "function";
    const target = callable
      ? Object.prototype.hasOwnProperty.call(value, "prototype") ? function capabilityLease() {} : () => undefined
      : Object.create(Object.getPrototypeOf(value));
    let facade: object;
    const handler: ProxyHandler<object> = {
      get(target, property) {
        assertAvailable();
        const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (targetDescriptor && !targetDescriptor.configurable && "value" in targetDescriptor && !targetDescriptor.writable) {
          return targetDescriptor.value;
        }
        return wrap(Reflect.get(raw, property, raw), { raw, facade });
      },
      set(target, property, nextValue) {
        assertAvailable();
        const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (targetDescriptor && !targetDescriptor.configurable && "value" in targetDescriptor && !targetDescriptor.writable) return false;
        return Reflect.set(raw, property, unwrap(nextValue), raw);
      },
      has(target, property) {
        assertAvailable();
        return Reflect.has(raw, property) || Reflect.has(target, property);
      },
      ownKeys(target) {
        assertAvailable();
        return [...new Set([...Reflect.ownKeys(raw), ...Reflect.ownKeys(target)])];
      },
      getOwnPropertyDescriptor(target, property) {
        assertAvailable();
        const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (targetDescriptor && !targetDescriptor.configurable) return targetDescriptor;
        const descriptor = Reflect.getOwnPropertyDescriptor(raw, property);
        if (!descriptor) return undefined;
        return "value" in descriptor
          ? { ...descriptor, configurable: true, value: wrap(descriptor.value, { raw, facade }) }
          : { ...descriptor, configurable: true };
      }
    };
    if (callable) {
      handler.apply = (_target, thisArgument, argumentsList) => {
        assertAvailable();
        const thisValue = receiver !== undefined && thisArgument === receiver.facade ? receiver.raw : unwrap(thisArgument);
        return wrap(Reflect.apply(value as (...args: never[]) => unknown, thisValue, argumentsList));
      };
      handler.construct = (_target, argumentsList, newTarget) => {
        assertAvailable();
        return wrap(Reflect.construct(value as new (...args: never[]) => object, argumentsList, newTarget)) as object;
      };
    }
    facade = new Proxy(target, handler);
    wrapped.set(raw, facade);
    rawByFacade.set(facade, raw);
    return facade;
  };
  return wrap(service) as T;
}

export function leaseCapabilityService<T>(
  service: T,
  authority: RegistrationLifecycleAuthority,
  consumerId: string,
  providerId: string
): T {
  return leaseService(service, authority, consumerId, providerId);
}
