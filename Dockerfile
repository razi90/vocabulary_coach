# Three stages: export the learning content, build the backend, run it.

# 1) The learning content lives in web/src/*.js (the browser loads it as is).
#    The backend reads it as JSON, generated here so the image is always in sync.
FROM node:22-alpine AS content
WORKDIR /src
COPY tools/export-content.js tools/
COPY web/src/ web/src/
RUN node tools/export-content.js /out/content.json

# 2) Build. Dependencies get their own layer so they stay cached.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY backend/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY backend/src src
COPY --from=content /out/content.json src/main/resources/content/content.json
# Tests need a database; they run outside the image build (see README).
RUN mvn -q -B -DskipTests package && cp target/vocabulary-coach-*.jar /app.jar

# 3) Run.
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app.jar app.jar
COPY web/ web/
ENV PORT=8080 \
    STATIC_LOCATION=file:/app/web/
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/liveness >/dev/null || exit 1
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
