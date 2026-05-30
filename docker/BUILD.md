## Build locally

From root directoy:

```
  docker buildx build --progress=plain --no-cache -t typeai/typeai-backend:latest . -f  ./docker/backend/Dockerfile
  docker buildx build --progress=plain --no-cache -t  typeai/typeai-frontend:latest . -f  ./docker/frontend/Dockerfile
```
