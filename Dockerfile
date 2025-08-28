# syntax=docker/dockerfile:1
FROM node:24-alpine

ENV PNPM_HOME="/pnpm"

ENV PATH="$PNPM_HOME:$PATH"

COPY . /telestory-ts-backend

WORKDIR /telestory-ts-backend

RUN apt-get update && apt-get install -y \
    python3 \
    python3-dev \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
RUN DEBUG=true corepack prepare pnpm@9.15.9 --activate

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

