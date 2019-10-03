/*******************************************************************************
 * Copyright (c) 2019 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v20.html
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
"use strict";

import { promisify } from "util";
import * as projectsController from "./controllers/projectsController";
import * as projectStatusController from "./controllers/projectStatusController";
import * as projectEventsController from "./controllers/projectEventsController";
import * as locale from "./utils/locale";
import * as logger from "./utils/logger";
import * as workspaceSettings from "./utils/workspaceSettings";
import * as socket from "./utils/socket";
import fs from "fs";
import * as constants from "./projects/constants";

const existsAsync = promisify(fs.exists);
const mkDirAsync = promisify(fs.mkdir);

// use export default in order for type definition files (*.d.ts) to be generated by the typescript compiler
export default class Filewatcher {
    /**
     * @function
     * @description Register a filewatcher listener
     * @param listener <Required | FWEventHandler> - The filewatcher event handler.
     * @returns void
     * @example
     * ```
     * filewatcher.registerListener({
     *   name: "eventListener",
     *   handleEvent: async (event, eventDetails) => {
     *       // event is the event string, eventDetails is the detailed message of the event
     *       ... ...
     *   }
     * ```
     * @property Event List:
     * @example projectCreation | projectChanged
     * ```json
     * {
     *    operationID : "cf283a082f4f8d9c46b5a5e9ce1faeee",
     *    projectID :   'libertyapp',
     *    host  :       '172.20.0.2',
     *    ports :       {
     *                      exposedPort:  '32771',
     *                      internalPort: '9080',
     *                      exposedDebugPort: '13729', (if project is in debug mode)
     *                      internalDebugPort: '7777' (if project is in debug mode)
     *                   }
     *    status :      'success'/'failed' (untranslated),
     *    error  :      [include error message only if the operation failed],
     *    logs   :      {
     *                    build : {
     *                    files: [
     *                            ‘/codewind-workspace/.logs/microclimate-dev-liberty-libertyapp.build.log’,
     *                             ‘/codewind-workspace/.logs/microclimate-dev-liberty-libertyapp.docker_build.log’
     *                            ]
     *                            }
     *                     app: {
     *                            dir: ‘/codewind-workspace/libertyapp/mc-target/liberty/wlp/usr/servers/defaultServer/logs/ffdc’  ,
     *                            files: [
     *                              ‘/codewind-workspace/libertyapp/mc-target/liberty/wlp/usr/servers/defaultServer/logs/console.log’,
     *                              ‘/codewind-workspace/libertyapp/mc-target/liberty/wlp/usr/servers/defaultServer/logs/messages.log’
     *                             ]
     *                           }
     *                   }
     * }
     * ```
     *
     * @example projectDeletion
     * ```json
     * {
     *   operationID : 'cf283a082f4f8d9c46b5a5e9ce1faeee',
     *   projectID:  ‘096d7c20-941e-11e8-9917-f1ce2bb403d1’,
     *   status:     ‘success’/ ‘failed’
     *  }
     * ```
     *
     * @example projectValidated
     * ```json
     * {
     *   operationID : 'cf283a082f4f8d9c46b5a5e9ce1faeee',
     *   status:       ‘success’/ ‘failed’,
     *   projectType:  ‘liberty’,
     *   projectID:  ‘microprofileapp1’,
     *   location:     ‘/home/codewind-workspace/microprofileapp1’
     *   results (Optional - only included if the operation failed) : [
     *                    {
     *                      severity: `error/warning`,
     *                      filename: `file1.ext`,
     *                      filepath: `/path/to/file`,
     *                      (Optional) type: `missing/invalid`,
     *                      label: `myLabel`,
     *                      details: ‘An error message if the action encountered a problem.’,
     *                      (Optional) quickfix: {
     *                                 fixID:‘The id of the quick fix’,
     *                                 name: ‘The display name for the quick fix’
     *                                 description: ‘Description of the quick fix actions’
     *                                }
     *                     },
     *                    {
     *                      severity: `error/warning`,
     *                      filename: `file2.ext`,
     *                      filepath: `/path/to/file`,
     *                      (Optional) type: `missing/invalid`,
     *                      label: `myLabel`,
     *                      details: ‘An error message if the action encountered a problem.’,
     *                      (Optional) quickfix: {
     *                                 fixID:‘The id of the quick fix’,
     *                                 name: ‘The display name for the quick fix’
     *                                 description: ‘Description of the quick fix actions’
     *                                }
     *                     },
     *                    {
     *                      severity: `error/warning`,
     *                      filename: `file3.ext`,
     *                      filepath: `/path/to/file`,
     *                      label: `myLabel`,
     *                      details: ‘An error message if the action encountered a problem.’,
     *                      (Optional) quickfix: {
     *                                 fixID:‘The id of the quick fix’,
     *                                 name: ‘The display name for the quick fix’
     *                                 description: ‘Description of the quick fix actions’
     *                                }
     *                     },
     *             ...
     *             ]
     *    }
     * ```
     * @example projectRestartResult
     * ```json
     * {
     *   operationID : 'cf283a082f4f8d9c46b5a5e9ce1faeee',
     *   projectID : 'microprofileapp1',
     *   status : 'success'/ 'failed' (untranslated),
     *   ports(Optional - included if success) : {
     *           exposedPort: '32771', (if container was restarted in order to switch modes)
     *           internalPort: '9080', (if container was restarted in order to switch modes)
     *           exposedDebugPort: '13729', (if project is in debug mode)
     *           internalDebugPort: '7777' (if project is in debug mode)
     *          },
     *   errorMsg(Optional - included if failed) : (translated error message)
     *  }
     * ```
     *
     * @example projectStatusChanged
     * ```json
     * (App status change)
     * {
     *   projectID : libertyapp,
     *   appStatus:    one of: starting, started, stopping, stopped or unknown,
     *   appErrorStatus:     [include error message only if the operation failed]
     *   detailedAppStatus: [detailed app status message. e.g. app ping path]
     * }
     *
     * (build status change)
     * {
     *   projectID : libertyapp,
     *   buildStatus:    inProgress/success/failed/buildRequired
     *   detailedBuildStatus: [optional: some detailed status on build in some cases, e.g. building container, or an error message if the build failed]
     *   lastbuild: 1533244020901 [optional: the timestamp will only be added if the build is success/failed]
     *   appImageLastBuild: 1539891101000  [optional: the timestamp will only be added if the application image build is success]
     *   buildImageLastBuild: 1539891101000  [optional: the timestamp will only be added if the build image build is success]
     * }
     *
     * (buildRequired change)
     * {
     *   projectID : libertyapp,
     *   buildRequired:    true/false
     * }
     * ```
     *
     * @example projectSettingsChanged
     * ```json
     *  {
     *   operationID : cf283a082f4f8d9c46b5a5e9ce1faeee,
     *   projectID : 096d7c20-941e-11e8-9917-f1ce2bb403d1,
     *   name : (project settings name)
     *   status :  success/failed,
     *   error :  (only include error if this setting failed)
     *   ports : (Optional - only included if the setting is internalPort/internalDebugPort)
     *      {
     *          exposedPort: <new Exposed Port if the project application port has changed>,
     *          internalPort: <new Internal Port if the project application port has changed>,
     *      } | {
     *          internalDebugPort: <new Internal Debug Port>
     *      },
     *   contextRoot: (Optional<string> - only included if the setting is contextRoot),
     *   healthCheck: (Optional<string> - only included if the setting is healthCheck),
     *   ignoredPaths: (Optional - only included if the setting is ignoredPaths)
     *         ["path1", "path2" ...]
     * ```
     *
     * @example projectLogsListChanged
     * ```json
     * {
     *   "projectID": "271c8f40-7721-11e9-81ae-6f8cd0194e7c",
     *   "build": {
     *       "origin": "workspace",
     *       "files": [
     *          "/codewind-workspace/.logs/spr-271c8f40-7721-11e9-81ae-6f8cd0194e7c/maven.build.log",
     *          "/codewind-workspace/.logs/spr-271c8f40-7721-11e9-81ae-6f8cd0194e7c/docker.build.log"
     *       ]
     *   }
     * ```
     *
     * @example  NewProjectAddedEvent
     * ```json
     * {
     *     "projectID": "271c8f40-7721-11e9-81ae-6f8cd0194e7c",
     *     "ignoredPaths": ["path1", "path2" ...]
     * }
     * ```
     *
     */
    registerListener: (listener: socket.FWEventHandler) => void ;

    /**
     * @function
     * @description Set the locale to use for translated messages.
     *
     * @param locale <Required | String[]>:- An array list of locale in priority order (first one higher priority)
     *
     * @example await filewatcher.setLocaleAPI(["en", "pr"])
     *
     * @returns Promise<ISetLocaleSuccess|ISetLocaleFailure>
     *  @property locale<string>: The file watcher locale has been set to
     *  @property error <Complex>: A JSON object containing an error message
     *  @property statusCode <number>:
     *  200: Successfully set locale
     *  500: Locale could not be set due to an internal error
     *
     * @example
     * ```json
     *  {
     *      "statusCode": 200,
     *      "locale": "en"
     *  }
     * ```
     */
    setLocale: (locale: string[]) => Promise<locale.ISetLocaleSuccess | locale.ISetLocaleFailure>;

    /**
     * @function
     * @description Set the logging level.
     *
     * @param level <Required | String>:- One of error, warn, info, debug, trace
     *
     * @example await filewatcher.setLogLevel("trace")
     *
     * @returns Promise<void>
     */
    setLoggingLevel: (level: string) => Promise<void>;

    /**
     * @function
     * @description Read the workspace settings file and load the properties into cache if they're valid.
     *
     * @example await filewatcher.readWorkspaceSettings();
     *
     * @returns Promise<workspaceSettings.IWorkspaceSettingsSuccess | workspaceSettings.IWorkspaceSettingsFailure>
     * Response codes:
     *  @property 200: Successfully received the request
     *  @property 400: Error when attempting to read the workspace settings file
     *
     */
    readWorkspaceSettings: () => Promise<workspaceSettings.IWorkspaceSettingsSuccess | workspaceSettings.IWorkspaceSettingsFailure>;

    /**
     * @function
     * @description Read the workspace settings file and load the properties into cache if they're valid.
     *
     * @example await filewatcher.writeWorkspaceSettings();
     *
     * @returns Promise<workspaceSettings.IWorkspaceSettingsSuccess | workspaceSettings.IWorkspaceSettingsFailure>
     * Response codes:
     *  @property 200: Successfully received the request
     *  @property 500: Error when attempting to write the workspace settings file
     *
     */
    writeWorkspaceSettings: (newWorkspaceSettings: any) => Promise<any>;


    /**
     * @function
     * @description Test the deployment registry to check if its a valid registry for building projects on Kubernetes.
     *
     * @param deploymentRegistry <Required | String>: Deployment Registry string
     *
     * @example await filewatcher.testDeploymentRegistry("myregistry");
     *
     * @returns Promise<workspaceSettings.IWorkspaceSettingsSuccess | workspaceSettings.IWorkspaceSettingsFailure>
     * Response codes:
     *  @property 200: Successfully received the request
     *  @property 400: Error when attempting to test the registry
     *
     */
    testDeploymentRegistry: (deploymentRegistry: string, pullImage?: string) => Promise<workspaceSettings.IDeploymentRegistryTestSuccess | workspaceSettings.IDeploymentRegistryTestFailure>;

    /**
     * @function
     * @description Emit a socket event to highlight the validity status of the Deployment Registry
     *
     * @param req <Required | workspaceSettings.IDeploymentRegistryStatusParams> - The request object.
     * Parameters:
     *  @property projectID <Required | String>: An alphanumeric identifier for a project.
     *  @property detailedDeploymentRegistryStatus <Required | String>: The detailed message of the Deployment Registry validity.
     *
     *
     * @returns Promise<workspaceSettings.IWorkspaceSettingsSuccess | workspaceSettings.IWorkspaceSettingsFailure>
     * Response codes:
     *  @property 200: Successfully received the request
     *  @property 400: Bad Request: projectID and detailedDeploymentRegistryStatus are required parameters
     *
     */
    deploymentRegistryStatus: (req: workspaceSettings.IDeploymentRegistryStatusParams) => Promise<workspaceSettings.IDeploymentRegistryStatusSuccess | workspaceSettings.IDeploymentRegistryStatusFailure> ;

    /**
     * @function
     * @description Create a new project. This API must be called with a unique project id (does not match any existing project ids).
     * @param req <Required | ICreateProjectParams> - The request object.
     * Parameters:
     *  @property projectID <Required | String>: An alphanumeric identifier for a project.
     *  @property projectType <Required | String>: An identifier key that describes how a project should be built.
     *  @property location <Required | String>: The project location URI within the file-watcher filesystem.
     *  @property startMode <Optional | String>: An optional start mode for the application.
     *  @property contextroot <Optional | String>: An optional context root path for the application.
     *  @property ignoredPaths <Optional | String[]>: An optional string array of relative file paths or regex for files want to be ignored for changes.
     *
     * @example await filewatcher.createProject(req)
     * ```json
     *  req:{
     *      "projectID": "microprofileapp1",
     *      "projectType": "liberty",
     *      "location": "/home/codewind-workspace/microprofileapp1",
     *      "startMode": "run"
     *  }
     * ```
     *
     *
     * @returns Promise<ICreateProjectSuccess | ICreateProjectFailure>
     *  @property operationId <String>: An alphanumeric identifier for the operation that is creating the project. Only available when the operation can be successfully created.
     *  @property error <Complex>: A JSON object container an error message
     *  @property logs <Complex>: A JSON object contains the build log location URI within the file-watcher filesystem.
     *  @property statusCode <number>:
     *  202: Successfully created an operation
     *  400:
     *     - Project id, type, and location are required parameters
     *     - Project type is not supported
     *     - The start mode is not supported for the project type
     *  404: Project ID or location doesn’t exist
     *  500: An operation couldn’t be created due to an internal error
     * @example
     * ```json
     *  {
     *      "statusCode": 202,
     *      "operationId": "589b49808f5f",
     *      "logs": {
     *          "build": {
     *              "file": "/codewind-workspace/.logs/lib-c2281250-36b4-11e9-a069-19717268a986/maven.build.log"
     *          }
     *      }
     *  }
     * ```
     *
     */
    createProject: (req: projectsController.ICreateProjectParams) => Promise<projectsController.ICreateProjectSuccess | projectsController.ICreateProjectFailure>;

    /**
     * @function
     * @description Get a list of project types.
     *
     * @param location <Optional | string> - The project location URI within the file-watcher filesystem.
     *
     * @example await filewatcher.getProjectTypes("/codewind-workspace/microprofileapp1")
     *
     * @returns Promise<IGetProjectTypesSuccess | IGetProjectTypesFailure>
     *  @property types <Complex>: Returns a list of project types (keys, untranslated). If no project location paramater was specified then a list of all known types will be returned. If a project location is provided then a list of types that match the project will be returned. An empty list will be returned if the project did not match any types. It is possible for a project to match multiple types.
     *  @property error <Complex>: A JSON object container an error message
     *  @property statusCode <number>:
     *  200: Successfully completed type discovery
     *  404: Project location doesn't exist
     *  500: Type discovery failed due to an internal error
     *  @example
     * ```json
     *  {
     *      "statusCode": 200,
     *      "types": [
     *          "microprofile",
     *          "spring"
     *      ]
     *  }
     * ```
     */
    getProjectTypes: (location: string) => Promise<projectsController.IGetProjectTypesSuccess | projectsController.IGetProjectTypesFailure>;

    /**
     * @function
     * @description Get a list of supported capabilities for the project.
     *
     * @param projectID <Required | string> - An alphanumeric identifier for a project.
     *
     * @example await filewatcher.getProjectCapabilities("microprofileapp1")
     *
     * @returns Promise<IGetProjectCapabilitiesSuccess | IGetProjectCapabilitiesFailure>
     *  @property capabilities <Complex>: Returns the capabilities of the project.
     *  @property error <Complex>: A JSON object container an error message
     *  @property statusCode <number>:
     *  @property 200: Successfully completed
     *  @property 404: Project ID does not exist
     *  @property 500: Retrieving start modes failed due to an internal error
     *
     * @example
     * ```json
     *  {
     *      "statusCode": 200,
     *      "capabilities": {
     *          "startModes": [
     *              "run",
     *              "debug"
     *          ],
     *          "controlCommands": [
     *              "restart"
     *          ]
     *      }
     *  }
     * ```
     *
     */
    getProjectCapabilities: (projectID: string) => Promise<projectsController.IGetProjectCapabilitiesSuccess | projectsController.IGetProjectCapabilitiesFailure>;

    /**
     * @function
     * @description Execute an action on a project.
     *
     * @param req <Required | IProjectActionParams> - The request object.
     * Parameters:
     *  @property action <Required | String>: An action key to perform on a project.
     *  @property projectID <Optional | String>: An alphanumeric identifier for a project.
     *  @property projectType <Optional | String>: An identifier key that describes how a project should be built.
     *  @property location <Optional | String>: The project location URI within the file-watcher filesystem.
     *  @property startMode <Optional | String>: Required if action is restart. Supported modes include: 'run', 'debug' (untranslated). Debug modes are currently only supported for projects of type 'liberty'.
     *
     * @example await filewatcher.performProjectAction(req)
     * ```json
     *  req:{
     *      "action": "validate",
     *      "projectType": "liberty",
     *      "projectID": "microprofileapp1",
     *      "location": "/home/codewind-workspace/microprofileapp1"
     *  }
     * ```
     * @returns Promise<IProjectActionSuccess | IProjectActionFailure>
     *  @property operationId <String>: An alphanumeric identifier for the operation that is creating the project. Only available when the operation can be successfully created.
     *  @property status <String>: Either 'success' or 'failed' (for sync operations, untranslated).
     *  @property error <Complex>: A JSON object container an error message and quick fix if one is available. (for sync operations)
     *  @property statusCode <number>:
     *  200: Successfully executed the action
     *  400: Invalid request
     *  404: Project ID or location does not exist
     *  500: An action couldn't be created due to an internal error
     *
     * @example
     * ```json
     *  {
     *      "statusCode": 404,
     *      "status": "failed",
     *      "error": {
     *          "msg": "An error message if the action encountered a problem."
     *      }
     *  }
     * ```
     *
     */
    performProjectAction: (req: projectsController.IProjectActionParams) => Promise<projectsController.IProjectActionSuccess | projectsController.IProjectActionFailure>;

    /**
     * @function
     * @description Reconfig a specific setting for a project.
     *
     * @param req <Required | IProjectSpecificationParams> - The request object.
     * Parameters:
     *  @property settings <Required | JsonArray>: The specific settings that user wants to reconfig for the project.
     *
     * @example await filewatcher.reconfigProjectSpecification(req)
     * ```json
     *  req: {
     *    projectID: microprofileproject
     *    settings: {
     *          "internalDebugPort": "7878",
     *          "contextRoot": "myproject"
     *      }
     *  }
     * ```
     *
     * @returns Promise<ProjectSpecificationFailure | IProjectSpecificationSuccess>
     *  @property operationId <String>: An alphanumeric identifier for the operation that is setting the project sepcification. Only available when the operation can be successfully created.
     *  @property error <Complex>: A JSON object container an error message
     *  @property statusCode <number>:
     *  202: Received the project specification setting request
     *  400: Invalid request
     *  404: Project ID does not exist
     *  500: An project specification couldn't be performed due to an internal error
     *
     * @example
     * ```json
     *  {
     *      "statusCode": 404,
     *      "status": "failed",
     *      "error": {
     *          "msg": "An error message if the project specification encountered a problem."
     *      }
     *  }
     * ```
     */
    reconfigProjectSpecification: (req: projectsController.IProjectSpecificationParams) => Promise<projectsController.IProjectSpecificationSuccess | projectsController.IProjectSpecificationFailure>;

    /**
     * @function
     * @description Get a list of project logs for a given project.
     *
     * @param projectID <Required | String> - An alphanumeric identifier for a project.
     *
     * @example await filewatcher.getProjectLogs(project.projectID);
     *
     * @returns Promise<IGetLogsSuccess | IGetLogsFailure>
     *  @property logs <Complex>: Returns a list of project logs, also returns ffdc directory path if it exists. If the specified project has no build logs or app logs, an empty list will be returned.
     *  @property origin <String>: Indicate whether the log file origin is within filewatcher workspace or within project container.
     *  @property file <String[]>: Path for the log file.
     *  @property dir <String>: Path for the log directory.
     * Response codes:
     *  @property 200: Successfully completed logs discovery
     *  @property 400: Bad request
     *  @property 404: Project location doesn't exist
     *  @property 500: Logs discovery failed due to an internal error
     *
     * @example
     * ```json
     *  {
     *      "statusCode": 200,
     *      "logs": {
     *          "build": {
     *              "origin": "workspace",
     *              "file": "/codewind-workspace/.logs/lib-c2281250-36b4-11e9-a069-19717268a986/maven.build.log",
     *              "files": [
     *                  "/codewind-workspace/.logs/lib-c2281250-36b4-11e9-a069-19717268a986/maven.build.log",
     *                  "/codewind-workspace/.logs/lib-c2281250-36b4-11e9-a069-19717268a986/docker.build.log"
     *              ]
     *          },
     *          "app": {
     *              "origin": "workspace’/‘container",
     *              "file": [‘/codewind-workspace/microprofileapp1/mc-target/liberty/wlp/usr/servers/defaultServer/logs/console.log’, ‘/codewind-workspace/microprofileapp1/mc-target/liberty/wlp/usr/servers/defaultServer/logs/messages.log’],
     *              "dir": "/codewind-workspace/microprofileapp1/mc-target/liberty/wlp/usr/servers/defaultServer/logs/ffdc",
     *              "files": [
     *                   "/codewind-workspace/microprofileapp1/mc-target/liberty/wlp/usr/servers/defaultServer/logs/messages.log",
     *                  "/codewind-workspace/microprofileapp1/mc-target/liberty/wlp/usr/servers/defaultServer/logs/console.log"
     *              ]
     *          }
     *      }
     *  }
     * ```
     *
     */
    getProjectLogs: (projectID: string) => Promise<projectsController.IGetLogsSuccess | projectsController.IGetLogsFailure>;

    /**
     * @function
     * @description Remove all helm releases and kill docker containers for all projects. The "success"/"failed" notification will be sent through registered listeners with a `filewatcherShutdown` event.
     *
     * @example await filewatcher.shutdown();
     *
     * @returns Promise<IShutdownSuccess | IShutdownFailure>
     * Response codes:
     *  @property 202: Successfully received the request
     *  @property 500: Shutdown could not be done due to an internal error
     *
     */
    shutdown: () => Promise<projectsController.IShutdownSuccess | projectsController.IShutdownFailure>;

    /**
     * @function
     * @description Removes the application container for the given project. This is a non-blocking call that returns right away but the delete event is sent over the socket.
     *
     * @param projectID <Required | String>: An alphanumeric identifier for a project.
     *
     * @example await filewatcher.deleteProject(projectID)
     *
     * @returns Promise<IDeleteProjectSuccess | IDeleteProjectFailure>
     * Response codes:
     *  @property 202: Successfully created delete operation
     *  @property 404: Project doesn't exist
     *  @property 500: Project could not be deleted due to an internal error
     *
     */
    deleteProject: (projectID: string) => Promise<projectsController.IDeleteProjectSuccess | projectsController.IDeleteProjectFailure>;

    /**
     * @function
     * @description Signal the occurrence of an event related to a particular project.
     *
     * @param req <Required | IUpdateStatusParams> - The request object.
     * Parameters:
     *  @property projectID <Required | String>: An alphanumeric identifier for a project.
     *  @property type <Required | String>: The status type. Supported types include: 'appState' and 'buildState'.
     *  @property status <Optional | String>: The states for appState.
     *  @property error <Optional | String>: The error for app status.
     *  @property buildStatus <Optional | String>: The states for buildState.
     *  @property detailedBuildStatus <Optional | String>: The detailed error message for build status.
     *  @property appImageLastBuild <Optional | String>: The last build timestamp for application image.
     *  @property buildImageLastBuild <Optional | String>: The last build timestamp for build image.
     *
     * @returns Promise<IUpdateStatusSuccess | IUpdateStatusFailure>
     * Response codes:
     *  @property 200: OK
     *  @property 400: Bad Request Required parameters: projectID, type, status
     *
     */
    updateStatus: (req: projectStatusController.IUpdateStatusParams) => Promise<projectStatusController.IUpdateStatusSuccess | projectStatusController.IUpdateStatusFailure> ;

    /**
     * @function
     * @description Check for when a new log file is available
     * @param projectID <Required | String> - An alphanumeric identifier for a project.
     * @param type <Required | String> - Either `build` or `app`
     * @returns <Required | Promise<ICheckNewLogFileSuccess | ICheckNewLogFileFailure>> - The log files json
     * Response codes:
     *  @property 200: The log file object
     *  @property 400: Bad Request Required parameters: projectID, type
     *  @property 404: Project log file does not exist
     *  @property 500: Internal status error
     */
    checkNewLogFile: (projectID: string, type: string) => Promise<projectsController.ICheckNewLogFileSuccess | projectsController.ICheckNewLogFileFailure>;

    /**
     * @function
     * @description Signal the occurrence of an update event related to a particular project.
     *
     * @param projectID <Required | String>: An alphanumeric identifier for a project.
     * @param timestamp <Required | number>: Timestamp for this file change event.
     * @param chunk <Required | number>: the current chunk number
     * @param chunk_total <Required | number>: the total chunks expected for this timestamp
     * @param eventArray <Required | IFileChangeEvent[]>: The file change event array for this project.
     *
     * @returns Promise<IUpdateProjectSuccess | IUpdateProjectFailure>
     * Response codes:
     *  @property 202: Success
     *  @property 400: Bad Request: projectID is a required parameter
     *  @property 404: Project does not exist
     *  @property 500: Retrieving start modes failed due to an internal error
     *
     */
    updateProjectForNewChange: (projectID: string, timestamp: number, chunk: number, chunk_total: number, eventArray: projectEventsController.IFileChangeEvent[]) => Promise<projectEventsController.IUpdateProjectSuccess | projectEventsController.IUpdateProjectFailure>;

    constructor() {
        this.createProjectsDataDir();

        this.setLocale = locale.setLocale;
        this.setLoggingLevel = logger.setLoggingLevel;
        this.readWorkspaceSettings = workspaceSettings.readWorkspaceSettings;
        this.writeWorkspaceSettings = workspaceSettings.writeWorkspaceSettings;
        this.testDeploymentRegistry = workspaceSettings.testDeploymentRegistry;
        this.registerListener = socket.registerListener;
        this.createProject = projectsController.createProject;
        this.getProjectTypes = projectsController.getProjectTypes;
        this.getProjectCapabilities = projectsController.getProjectCapabilities;
        this.performProjectAction = projectsController.projectAction;
        this.reconfigProjectSpecification = projectsController.projectSpecification;
        this.getProjectLogs = projectsController.logs;
        this.shutdown = projectsController.shutdown;
        this.deleteProject = projectsController.deleteProject;
        this.updateStatus = projectStatusController.updateStatus;
        this.deploymentRegistryStatus = workspaceSettings.deploymentRegistryStatus;
        this.checkNewLogFile = projectsController.checkNewLogFile;
        this.updateProjectForNewChange = projectEventsController.updateProjectForNewChange;
    }

    async createProjectsDataDir(): Promise<void> {
        const projectsDataDir: string = constants.projectConstants.projectsDataDir;
        if (!await existsAsync(projectsDataDir)) {
            return await mkDirAsync(projectsDataDir);
        }
        return;
    }
}

// use module.exports so that the module can be imported in .js files using require()
module.exports = Filewatcher;
