FROM node@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

ARG K_NEX_SOURCE_COMMIT
ARG K_NEX_APPLICATION_DIGEST
ARG K_NEX_FIXTURE_LABEL
LABEL org.opencontainers.image.revision=${K_NEX_SOURCE_COMMIT}
LABEL dev.k-nex.application-digest=${K_NEX_APPLICATION_DIGEST}
LABEL p9-fixture=${K_NEX_FIXTURE_LABEL}
ENV K_NEX_SOURCE_COMMIT=${K_NEX_SOURCE_COMMIT}
ENV K_NEX_APPLICATION_DIGEST=${K_NEX_APPLICATION_DIGEST}
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY static-deployment/operator-packages /tmp/operator-packages
RUN npm install --no-save --legacy-peer-deps --ignore-scripts --no-audit --no-fund /tmp/operator-packages/*.tgz
COPY src ./src
COPY static-deployment/tsconfig.next.json ./tsconfig.json
COPY static-deployment/tsconfig.customer.json ./
COPY static-deployment/next.config.mjs ./
COPY static-deployment/app ./src/app
COPY static-deployment/payload.config.ts ./src/static-payload.config.ts
COPY static-deployment/static-runtime.ts ./src/static-runtime.ts
COPY static-deployment/customer-application-gate.mjs ./customer-application-gate.mjs
COPY static-deployment/release.json ./release.json
# The release image must compile and execute the committed customer Payload
# composition/registry gate before it can carry a static deployment attestation.
RUN DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/customer-alpha PAYLOAD_SECRET=fixture-static-customer-build npm run build && node customer-application-gate.mjs
RUN mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static
COPY static-deployment/healthcheck.mjs static-deployment/release-worker.mjs static-deployment/web-admin-container.mjs ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=100ms --timeout=1s --start-period=100ms --retries=5 CMD ["node", "healthcheck.mjs"]
CMD ["node", ".next/standalone/server.js"]
