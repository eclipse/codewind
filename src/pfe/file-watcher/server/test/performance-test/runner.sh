#!/bin/bash
#*******************************************************************************
# Copyright (c) 2020 IBM Corporation and others.
# All rights reserved. This program and the accompanying materials
# are made available under the terms of the Eclipse Public License v2.0
# which accompanies this distribution, and is available at
# http://www.eclipse.org/legal/epl-v20.html
#
# Contributors:
#     IBM Corporation - initial API and implementation
#*******************************************************************************

# Colors for success and error messages
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\e[36m'
YELLOW='\e[33m'
MAGENTA='\e[35m'
RESET='\033[0m'

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
CURR_DIR=$(pwd)

source $DIR/../scripts/utils.sh
cd $CURR_DIR

TEST_ENV="local"
CLEAN_RUN="n"
POST_CLEAN="n"
CREATE_PROJECT_FLAG="y"
ITERATIONS=3
CONVERT_ONLY=false

function usage {
    me=$(basename $0)
    cat <<EOF
Usage: $me: [-<option letter> <option value> | -h]
Options:
    --environment       The test environment to run in - default: local
    --clean-run         Flag to enable a clean test run - default: n
    --post-clean        Flag to perform a post clean up - default: n
    --create-projects   Flag to perform a post clean up - default: y
    --iterations        Number of iterations to evaluate the performance on - default: 3
    --report-only       Convert data to csv only. Will not run performance test and use existing data json on path. Default: false
    -h | --help         Display the man page
EOF
}

while :; do
    case $1 in
        --environment=?*)
        TEST_ENV=${1#*=}
        ;;
        --clean-run=?*)
        CLEAN_RUN=${1#*=}
        ;;
        --post-clean=?*)
        POST_CLEAN=${1#*=}
        ;;
        --create-projects=?*)
        CREATE_PROJECT_FLAG=${1#*=}
        ;;
        --iterations=?*)
        ITERATIONS=${1#*=}
        ;;
        --report-only)
        CONVERT_ONLY=true
        ;;
        -h|--help)
        usage
        exit
        ;;
        *) break
    esac
    shift
done

if [ -z $DATE_NOW ]; then
    export DATE_NOW=$(date +"%d-%m-%Y")
fi
if [ -z $TIME_NOW ]; then
    export TIME_NOW=$(date +"%H.%M.%S")
fi
LOGS_DATA_DIR=$TEST_INFO_DIR/performance-test-data/$TEST_ENV/$TURBINE_PERFORMANCE_TEST/$DATE_NOW/$TIME_NOW
mkdir -p $LOGS_DATA_DIR

TARGET_DIR="$CURR_DIR/data/$TEST_ENV/$TURBINE_PERFORMANCE_TEST"
export TEST_TYPE=$TEST_ENV

if [[ $CONVERT_ONLY == false ]]; then
    if [ "$TEST_ENV" != "local" ] && [ "$TEST_ENV" != "kube" ]; then
        checkExitCode 1 "Test can only be ran on local or kube environment" true
    fi

    echo -e "${CYAN}> This performance run is for $TEST_ENV test environment and will run for $ITERATIONS iteration(s) ${RESET}"

    echo -e "${CYAN}> Creating data directory ${RESET}"
    rm -rf $TARGET_DIR
    mkdir -p $TARGET_DIR
    checkExitCode $? "Failed to create data directory." true

    echo -e "${CYAN}> Switching to release directory ${RESET}"
    cd "$CURR_DIR/$RELEASE_DIR/$TEST_PATH"
    checkExitCode $? "Failed to switch release directory." true

    for run in $(seq 1 $ITERATIONS);
        do
            echo -e "${CYAN}> Iteration: $run ${RESET}"
            # for the first iteration, we only do a clean run and no post clean
            if [[ $run -eq 1 ]]; then
                CLEAN_RUN="y"
                POST_CLEAN="n"
            elif [[ $run -eq $ITERATIONS ]]; then
            # for the last iteration, we only do a post clean and no clean run
                CLEAN_RUN="n"
                POST_CLEAN="y"
            else
            # for all other iteration, we do no clean run or post clean
                CLEAN_RUN="n"
                POST_CLEAN="n"
            fi
            USE_PERFORMANCE_CWCTL=${USE_PERFORMANCE_CWCTL} PERFORMANCE_DATA_DIR=${TARGET_DIR} NAMESPACE=${NAMESPACE} CLUSTER_IP=${CLUSTER_IP} CLUSTER_PORT=${CLUSTER_PORT} CLUSTER_USER=${CLUSTER_USER} CLUSTER_PASSWORD=${CLUSTER_PASSWORD} CLUSTER_PORT=${CLUSTER_PORT} USER_DEVFILE=${USER_DEVFILE} REGISTRY_SECRET_ADDRESS=${REGISTRY_SECRET_ADDRESS} REGISTRY_SECRET_USERNAME=${REGISTRY_SECRET_USERNAME} REGISTRY_SECRET_PASSWORD=${REGISTRY_SECRET_PASSWORD} IMAGE_PUSH_REGISTRY_NAMESPACE=${IMAGE_PUSH_REGISTRY_NAMESPACE} INTERNAL_REGISTRY=${INTERNAL_REGISTRY} ./test.sh -t $TEST_ENV -s functional -c $CLEAN_RUN -p $POST_CLEAN -o $CREATE_PROJECT_FLAG |& tee "$LOGS_DATA_DIR/iteration-$run.log"
        done
fi

cd $CURR_DIR

echo -e "${CYAN}> Checking for virtualenv ${RESET}"
virtualenv --version > /dev/null 2>&1
checkExitCode $? "Missing virtualenv command. Please install and try again." true

echo -e "${CYAN}> Checking for python ${RESET}"
python --version > /dev/null 2>&1
checkExitCode $? "Missing python command. Please install and try again." true

echo -e "${CYAN}> Checking for pip ${RESET}"
pip > /dev/null 2>&1
checkExitCode $? "Missing pip command. Please install and try again." true

echo -e "${CYAN}> Creating python virtual environment ${RESET}"
virtualenv venv -p $(which python) > /dev/null 2>&1
checkExitCode $? "Failed to create up python virtual environment. Please try again." true

echo -e "${CYAN}> Activating python virtual environment ${RESET}"
source venv/bin/activate > /dev/null 2>&1
checkExitCode $? "Failed to activate up python virtual environment. Please try again." true

echo -e "${CYAN}> Installing required python dependencies: pandas ${RESET}"
pip install pandas > /dev/null 2>&1
checkExitCode $? "Failed to install pandas module. Please try again." true

echo -e "${CYAN}> Installing required python dependencies: numpy ${RESET}"
pip install numpy > /dev/null 2>&1
checkExitCode $? "Failed to install numpy module. Please try again." true

echo -e "${CYAN}> Running data analyzer script ${RESET}"
PY_FILE="analyze-data.py"
python $PY_FILE
checkExitCode $? "Failed to run python script. Data is saved under codewind clone. Please fix the issue and try again with --report-only flag to generate the report."

echo -e "${CYAN}> Deactivating python virtual environment ${RESET}"
deactivate venv > /dev/null 2>&1
checkExitCode $? "Failed to deactivate up python virtual environment. Please try again." true

echo -e "${BLUE}Copying over performance data from $TARGET_DIR to $LOGS_DATA_DIR ... ${RESET}"
cp -r $TARGET_DIR/* $LOGS_DATA_DIR/
checkExitCode $? "Failed to copy data. Please check the source directory for data in $TARGET_DIR" true

CSV_FILENAME="$TEST_ENV-$TURBINE_PERFORMANCE_TEST"-performance-data.csv
CSV_BASELINE_DIR=$TEST_INFO_DIR/performance-test-baseline/$TEST_ENV/$TURBINE_PERFORMANCE_TEST
mkdir -p $CSV_BASELINE_DIR

if [ -e "$CSV_BASELINE_DIR/$CSV_FILENAME" ]; then
    echo -e "${BLUE}Comparing csv paths for $TEST_ENV local with baseline file "$COMPARE_FILEPATH_LOCAL" ... ${RESET}"
    ./compare-csv.sh --baseline-file="$CSV_BASELINE_DIR/$CSV_FILENAME" --comparable-file="$LOGS_DATA_DIR/$CSV_FILE" --save="$LOGS_DATA_DIR/data-comparison.log"
    checkExitCode $? "Failed to compare csv from baseline "$COMPARE_FILEPATH_LOCAL" to comparable "$LOGS_DATA_DIR/$CSV_FILE"" true
fi

echo -e "${BLUE}Copying over performance data csv from "$LOGS_DATA_DIR/$CSV_FILE" to $CSV_BASELINE_DIR ... ${RESET}"
cp "$LOGS_DATA_DIR/$CSV_FILE" $CSV_BASELINE_DIR/
checkExitCode $? "Failed to copy performance data csv. Please check the source directory for data in "$LOGS_DATA_DIR/$CSV_FILE"" true
