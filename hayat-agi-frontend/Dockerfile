# Multi-stage build: vite -> nginx static serve.
#
# VITE_API_BASE_URL is baked in at build time (Vite inlines import.meta.env.*)
# so changing it requires a rebuild.

FROM node:20-alpine AS builder

ARG VITE_API_BASE_URL=http://localhost:5000/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
