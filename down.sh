#!/bin/bash

SCRIPT_HOME=$(cd $(dirname "${0}")/ && pwd)
PROJECT_HOME=$(cd $(dirname "${0}")/../../ && pwd)

pushd ${SCRIPT_HOME}
    docker-compose down
popd
