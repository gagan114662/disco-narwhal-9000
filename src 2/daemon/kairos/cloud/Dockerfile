FROM oven/bun:1.2.23

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["bun", "./daemon/kairos/cloud/bootstrap.ts"]
