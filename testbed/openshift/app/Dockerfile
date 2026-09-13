# OS-1F real-Sandbox testbed image - one tiny, reusable Spring Boot log
# generator, deployed ~10 times under different SERVICE_NAME/SERVICE_ROLE
# identities. TEST INFRASTRUCTURE ONLY - never part of the Log Explorer
# product image.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -o -B dependency:go-offline || mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
# Arbitrary UID, group 0 - runs correctly under OpenShift's default
# restricted SCC, which assigns a random non-root UID at deploy time.
RUN addgroup -S testbed && adduser -S testbed -G testbed
COPY --from=build /build/target/testbed-service.jar app.jar
USER testbed
EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
