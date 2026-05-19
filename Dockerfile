FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV VITE_API_URL=
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/backend ./backend
COPY --from=build /app/dist ./dist
RUN mkdir -p uploads
EXPOSE 4000
CMD ["npm", "start"]
