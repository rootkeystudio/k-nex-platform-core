# Product Vision and Boundaries

## Vision

K-Nex is a backend product platform for repeatedly delivering custom business applications without rebuilding foundational logic for every customer.

A customer may need a familiar combination such as CMS and CRM, or a vertical combination such as:

- logistics: shipments, dispatch, live tracking, driver operations;
- restaurant: QR menu, inventory, recipe costing, budgeting;
- agency: CMS, forms, CRM, proposals, reporting;
- another industry with its own domain modules.

The result delivered to each customer is an independent product with its own user interface, design language, database, infrastructure, and release history.

## Product model

K-Nex follows a **software product line** model:

```text
shared kernel
+ reusable capability modules
+ vertical presets
+ customer application and extensions
= customer-specific product
```

The economic goal is to reuse tested business logic while preserving the freedom to design each customer product differently.

## What K-Nex is

- A style-free backend kernel.
- A set of versioned, composable modules.
- A contract for module dependencies, permissions, events, jobs, and migrations.
- A repeatable method for creating and operating separate customer applications.
- A foundation on which Payload can provide schema, admin, API, authentication, and migration capabilities.

## What K-Nex is not

- A shared multi-tenant SaaS control plane.
- A universal frontend or design system forced on every customer.
- A single database containing all customers.
- A collection of customer checks such as `if (customerId === ...)`.
- A promise that every feature is runtime-toggleable.
- A reason to place all business logic inside Payload hooks.

## Customer ownership boundary

A customer application owns:

- branding and design tokens;
- CSS and frontend components;
- public website and application routes;
- Payload admin customizations specific to that customer;
- selected module versions and configuration;
- customer-specific integrations and extensions;
- environment configuration, infrastructure, and deployment;
- final generated database migrations.

Shared packages own reusable behavior and contracts.

## Reuse rule

A feature should begin in the narrowest correct location.

1. A one-customer requirement starts as a customer extension.
2. When the same business capability appears in a second customer, the common behavior is identified.
3. Reusable behavior is extracted into a module with explicit configuration points.
4. Customer-specific policy remains outside the reusable module.

This rule avoids premature generalization while still allowing the platform to become more capable with every project.

## Success criteria

The platform is successful when all of the following are routine:

- Create a new customer application without copying core source code.
- Compose only the modules that the customer needs.
- Build a completely different visual language without changing shared backend packages.
- Upgrade one customer while another stays on an older compatible release.
- Detect an invalid module combination before deployment.
- Run migrations and rollbacks for one customer without affecting others.
- Fix a shared security or logic bug once and release it as a new package version.
- Promote repeated customer logic into a reusable module without breaking existing deployments.

## Primary constraints

- TypeScript-first development.
- Private package distribution.
- Exact dependency versions in customer applications.
- Independent deployment and database per customer.
- Backend-first modules, with optional headless UI companions where useful.
- No styling in the platform core.