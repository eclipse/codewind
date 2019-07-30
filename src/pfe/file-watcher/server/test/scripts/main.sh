#!/usr/bin/env bash

# Colors for success and error messages
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;36m'
RESET='\033[0m'

function usage {
    me=$(basename $0)
    cat <<EOF
Usage: $me: [-<option letter> <options value> | -h]
Options:
    -t # Test type, currently support local and kube - Mandatory
    -b # Test branch - Mandatory
    -s # Test suite - Mandatory
    -i # Ignore post cleanup, ignore post test automation cleanup for debug purpose, currently support y and n - Optional
    -h # Display the man page
EOF
}

while getopts "t:b:s:i:h" OPTION; do
    case "$OPTION" in
        t) 
            TEST_TYPE=$OPTARG
            # Check if test type argument is corrent
            if [[ ($TEST_TYPE != "local") && ($TEST_TYPE != "kube") ]]; then
                echo -e "${RED}Test type argument is not correct. ${RESET}\n"
                usage
                exit 1
            fi
            ;;
        b) 
            TEST_BRANCH=$OPTARG
            ;;
        s) 
            TEST_SUITE=$OPTARG
            ;;
        i)
            IGNORE_POST_CLEANUP=$OPTARG
            # Check if ignore post cleanup argument is corrent
            if [[ ($IGNORE_POST_CLEANUP != "y") && ($IGNORE_POST_CLEANUP != "n") ]]; then
                echo -e "${RED}Ignore post cleanup argument is not correct. ${RESET}\n"
                usage
                exit 1
            fi
            ;;
        *)
            usage
            exit 0
            ;;
    esac
done

# Chekc mandatory arguments have been set up
if [[ (-z $TEST_TYPE) || (-z $TEST_BRANCH) ]]; then
    echo -e "${RED}Mandatory arguments are not set up. ${RESET}\n"
    usage
    exit 1
fi

# Pre test automation cleanup
./run.sh -t $TEST_TYPE -f cleanup
if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}Pre test automation cleanup is successful. ${RESET}\n"
else
    echo -e "${RED}Pre test automation cleanup is failed. ${RESET}\n"
    exit 1
fi

# Set up test automation
./run.sh -t $TEST_TYPE -b $TEST_BRANCH -f setup
if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}Set up test automation is successful. ${RESET}\n"
else
    echo -e "${RED}Set up test automation is failed. ${RESET}\n"
    exit 1
fi

# Run test cases
./test.sh -t $TEST_TYPE -s $TEST_SUITE
if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}Run test cases is successful. ${RESET}\n"
else
    echo -e "${RED}Run test cases is failed. ${RESET}\n"
    exit 1
fi

# Post test automation cleanup
if [[ -z $IGNORE_POST_CLEANUP || $IGNORE_POST_CLEANUP == "n" ]]; then
    ./run.sh -t $TEST_TYPE -f cleanup
    if [[ $? -eq 0 ]]; then
        echo -e "${GREEN}Post test automation cleanup is successful. ${RESET}\n"
    else
        echo -e "${RED}Post test automation cleanup is failed. ${RESET}\n"
        exit 1
    fi
fi
