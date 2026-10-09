# ============================================================
# Dockerfile — AprovaHub Estancorp
#
# Build static SPA served by Nginx
# Target: linux/arm64 (AWS t4g.medium)
# ============================================================

FROM nginx:1.27-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files
COPY index.html /usr/share/nginx/html/
COPY validate.html /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/

# supabase/ (migrations + edge functions) fica de fora da imagem: é
# aplicado manualmente no dashboard/CLI do Supabase, não é servido.

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
