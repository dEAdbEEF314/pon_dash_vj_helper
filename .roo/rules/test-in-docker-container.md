# test-in-docker-container

## Rules for Test Execution and Artifact Placement
- **Test Execution Environment**: As a general rule, functional verification and automated testing for this project must be conducted using a Docker (`docker-compose.yml`) environment.
- **Storage Directory**: All files required for test execution and verification—including scripts, verification logs, screenshots, and result reports—must be created or generated under the `test-results/` directory.
