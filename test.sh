#!/bin/bash
#*******************************************************************************
# Copyright (c) 2019 IBM Corporation and others.
# All rights reserved. This program and the accompanying materials
# are made available under the terms of the Eclipse Public License v2.0
# which accompanies this distribution, and is available at
# http://www.eclipse.org/legal/epl-v20.html
#
# Contributors:
#     IBM Corporation - initial API and implementation
#*******************************************************************************


#Colours
MAGENTA='\033[0;35m'
BLUE='\033[0;34m'
RED='\033[0;31m'
RESET='\033[0m'



ARCH=`uname -m`;

printf "\n\n${MAGENTA}Platform: $ARCH ${RESET}\n"
# Run filewatcher tests if the scope is set accordingly, otherwise default to portal


# Run eslint
echo $PATH
export CURRENTDIR=$PWD

cd ~
mkdir -p .local/bin
mkdir -p .local/node
cd .local/node
curl -O http://nodejs.org/dist/v10.9.0/node-v10.9.0-linux-x64.tar.gz
tar -xzf node-v10.9.0-linux-x64.tar.gz
ln -s node-v10.9.0-linux-x64 latest
cd ../bin
ln -s ../node/latest/bin/node
ln -s ../node/latest/bin/npm
echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc

cd $CURRENTDIR


cd src/pfe/portal
npm install
npm run eslint
if [ $? -ne 0 ]; then
    exit 1
fi
cd ../../..

# Start microclimate.
./run.sh;

# Build the tests and run them against the portal.
cd test/
npm install
npm run eslint
if [[ ! -z $TRAVIS_BUILD_NUMBER && $? -ne 0 ]]; then
  exit 1
fi

npm run test
rc=$?;
cd ..

# Output portal logs
printf "\n${MAGENTA}********** codewind-pfe logs **********\n\n"
docker logs codewind-pfe
printf "${RESET}"

# Shutdown and cleanup.
./stop.sh;


exit $rc;
