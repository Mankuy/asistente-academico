FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY backend_academico.js sessions_store.js guardian.js audit_json.js biblioteca_store.js docx_export.js bunker.js ./
COPY public ./public

RUN mkdir -p data/sessions entregables biblioteca

ENV PORT=4000
ENV BIND_HOST=0.0.0.0

EXPOSE 4000

CMD ["node", "backend_academico.js"]