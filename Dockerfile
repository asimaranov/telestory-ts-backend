# syntax=docker/dockerfile:1
FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install build dependencies required for native modules like better-sqlite3
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    sqlite-dev

COPY . /telestory-ts-backend

WORKDIR /telestory-ts-backend

RUN corepack enable
RUN DEBUG=true corepack prepare pnpm@9.15.9 --activate

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

