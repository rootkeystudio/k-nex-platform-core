FROM node@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

ARG K_NEX_SOURCE_COMMIT
ARG K_NEX_APPLICATION_DIGEST
LABEL org.opencontainers.image.revision=${K_NEX_SOURCE_COMMIT}
LABEL dev.k-nex.application-digest=${K_NEX_APPLICATION_DIGEST}
ENV K_NEX_SOURCE_COMMIT=${K_NEX_SOURCE_COMMIT}
ENV K_NEX_APPLICATION_DIGEST=${K_NEX_APPLICATION_DIGEST}
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY static-deployment/server.mjs static-deployment/healthcheck.mjs static-deployment/release.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=100ms --timeout=1s --start-period=100ms --retries=5 CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.mjs"]
