FROM oven/bun:1.3.11

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .

# Drop privileges: the oven/bun base image ships a non-root `bun` user (UID 1000).
USER bun

CMD ["bun", "./daemon/kairos/cloud/bootstrap.ts"]
