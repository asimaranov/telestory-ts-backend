# syntax=docker/dockerfile:1
FROM node:24-slim

ENV PNPM_HOME="/pnpm"

ENV PATH="$PNPM_HOME:$PATH"

COPY . /telestory-ts-backend

WORKDIR /telestory-ts-backend

RUN corepack enable
RUN DEBUG=true corepack prepare pnpm@9.15.9 --activate

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

