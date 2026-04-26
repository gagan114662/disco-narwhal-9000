# Minimal container image for the KAIROS CLI/daemon.
# Used by .github/workflows/container-scan.yml for Trivy scans even if it is
# never deployed; the scan output protects us from CVE drift in the runtime
# image and bundled dependencies.
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS deps

# Pin runtime image by digest. Refresh with:
#   docker pull oven/bun:1.3.11
#   docker inspect --format='{{index .RepoDigests 0}}' oven/bun:1.3.11

WORKDIR /app
COPY ["src 2/package.json", "src 2/bun.lock", "./"]
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS runtime
WORKDIR /app
RUN useradd --system --uid 10001 --create-home kairos \
 && mkdir -p /app && chown -R kairos:kairos /app
USER kairos
COPY --chown=kairos:kairos --from=deps /app/node_modules ./node_modules
COPY --chown=kairos:kairos ["src 2/", "./"]

ENV NODE_ENV=production \
    CLAUDE_CONFIG_DIR=/home/kairos/.claude

EXPOSE 7777
ENTRYPOINT ["bun", "./entrypoints/cli.tsx"]
CMD ["kairos", "status"]
