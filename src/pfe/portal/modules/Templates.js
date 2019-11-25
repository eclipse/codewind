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

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const uuidv5 = require('uuid/v5');

const cwUtils = require('../modules/utils/sharedFunctions');
const Logger = require('./utils/Logger');
const TemplateError = require('./utils/errors/TemplateError');

const log = new Logger('Templates.js');

const DEFAULT_REPOSITORY_LIST = [
  {
    url: 'https://raw.githubusercontent.com/codewind-resources/codewind-templates/master/devfiles/index.json',
    description: 'Codewind project templates help you create containerized projects for various runtimes.',
    enabled: true,
    protected: true,
    projectStyles: ['Codewind'],
    name: 'Default templates',
  },
];

const kabaneroDescription = 'Kabanero, an open source project, brings together open source technologies into a microservices-based framework.' +
'Kabanero builds cloud native applications ready for deployment onto Kubernetes and Knative.'

const KABANERO_REPO = {
  url: 'https://github.com/kabanero-io/collections/releases/download/0.2.1/kabanero-index.json',
  name: 'Kabanero Collections',
  description: kabaneroDescription,
  enabled: false,
  protected: true,
};

// only add the kabanero repo locally
if (!global.codewind.RUNNING_IN_K8S) {
  DEFAULT_REPOSITORY_LIST.push(KABANERO_REPO);
}

module.exports = class Templates {

  constructor(workspace) {
    // If this exists it overrides the contents of DEFAULT_REPOSITORY_LIST
    this.projectTemplates = [];
    // If a repository is added or removed then update the template list on the next GetTemplates
    this.projectTemplatesNeedsRefresh = true;
    this.repositoryFile = path.join(workspace, '.config/repository_list.json');
    this.repositoryList = DEFAULT_REPOSITORY_LIST;
    this.providers = {};
  }

  async initializeRepositoryList() {
    try {
      let { repositories } = this;
      if (await cwUtils.fileExists(this.repositoryFile)) {
        repositories = await fs.readJson(this.repositoryFile);
        this.projectTemplatesNeedsRefresh = true;
      }
      repositories = await updateRepoListWithReposFromProviders(this.providers, repositories, this.repositoryFile);
      repositories = await fetchAllRepositoryDetails(this.repositoryList);
      this.repositoriesList = repositories;
      await writeRepositoryList(this.repositoryFile, this.repositoryList);
    } catch (err) {
      log.error(`Error initalizing repository list: ${err}`);
    }
  }

  // TEMPLATES

  async getTemplates(showEnabledOnly, projectStyle) {
    // this.repositoryList = await updateRepoListWithReposFromProviders(this.providers, this.repositoryList, this.repositoryFile);
    let templates = this.projectTemplates;
    if (this.projectTemplatesNeedsRefresh) {
      const repositories = (String(showEnabledOnly) === 'true')
        ? this.getEnabledRepositories()
        : this.repositoryList;
      templates = await getTemplatesFromRepos(repositories);
    }
    if (projectStyle) return filterTemplatesByStyle(templates, projectStyle);
    return templates;
  }

  async getAllTemplateStyles() {
    const templates = await this.getTemplates(false, false);
    return getTemplateStyles(templates);
  }

  // REPOSITORIES

  getRepositories() {
    // this.repositoryList = await updateRepoListWithReposFromProviders(this.providers, this.repositoryList, this.repositoryFile);
    return this.repositoryList;
  }

  getEnabledRepositories() {
    return this.getRepositories().filter(repo => repo.enabled);
  }

  /**
   * @param {String} url
   * @return {JSON} reference to the repo object in this.repositoryList
   */
  getRepository(url) {
    const index = getRepositoryIndex(url, this.getRepositories());
    if (index < 0) throw new Error(`no repository found with URL '${url}'`);
    const repo = this.getRepositories()[index];
    return repo;
  }

  doesRepositoryExist(url) {
    try {
      this.getRepository(url);
      return true;
    } catch (error) {
      return false;
    }
  }

  async batchUpdate(requestedOperations) { 
    const operationResults = requestedOperations.map(operation => this.performOperationOnRepository(operation));
    await writeRepositoryList(this.repositoryFile, this.repositoryList);
    return operationResults;
  }

  performOperationOnRepository(operation) {
    const { op, url, value } = operation;
    let operationResult = {};
    if (op === 'enable') {
      operationResult = this.enableOrDisableRepository({ url, value });
    }
    operationResult.requestedOperation = operation;
    return operationResult;
  }

  /**
   * @param {JSON} { url (URL of template repo to enable or disable), value (true|false)}
   * @returns {JSON} { status, error (optional) }
   */
  enableOrDisableRepository({ url, value }) {
    if (!this.doesRepositoryExist(url)) {
      return {
        status: 404,
        error: 'Unknown repository URL',
      };
    }
    try {
      const repo = this.getRepository(url);
      repo.enabled = (value === 'true' || value === true);
      return {
        status: 200
      };
    } catch (error) {
      return {
        status: 500,
        error: error.message,
      };
    }
  }

  /**
   * Add a repository to the list of template repositories.
   */
  async addRepository(repoUrl, repoDescription, repoName, isRepoProtected) {
    let url;
    try {
      url = new URL(repoUrl).href;
    } catch (error) {
      if (error.message.includes('Invalid URL')) {
        throw new TemplateError('INVALID_URL', repoUrl);
      }
      throw error;
    }

    if (this.getRepositories().find(repo => repo.url === repoUrl)) {
      throw new TemplateError('DUPLICATE_URL', repoUrl);
    }

    if (!(await doesURLPointToIndexJSON(url))) {
      throw new TemplateError('URL_DOES_NOT_POINT_TO_INDEX_JSON', url);
    }

    let newRepo = {
      id: uuidv5(url, uuidv5.URL),
      name: repoName,
      url,
      description: repoDescription,
      enabled: true,
    }
    newRepo = await fetchRepositoryDetails(newRepo);
    if (isRepoProtected !== undefined) {
      newRepo.protected = isRepoProtected;
    }

    try {
      await this.addRepositoryToProviders(newRepo);
    }
    catch (err) {
      throw new TemplateError('ADD_TO_PROVIDER_FAILURE', url, err.message);
    }
    this.repositoryList.push(newRepo);
    try {
      await writeRepositoryList(this.repositoryFile, this.repositoryList);
      this.projectTemplatesNeedsRefresh = true;
    }
    catch (err) {
      // rollback
      this.repositoryList = this.repositoryList.filter(repo => repo.url !== url);
      this.removeRepositoryFromProviders(newRepo).catch(error => log.warn(error.message));
      throw err;
    }
  }

  async deleteRepository(repoUrl) {
    let deleted;
    const repositoryList = this.repositoryList.filter((repo) => {
      if (repo.url === repoUrl) {
        deleted = repo;
        return false;
      }
      return true;
    });
    if (deleted) {
      await this.removeRepositoryFromProviders(deleted);
      this.repositoryList = repositoryList;
      try {
        await writeRepositoryList(this.repositoryFile, this.repositoryList);
        this.projectTemplatesNeedsRefresh = true;
      }
      catch (err) {
        // rollback
        this.repositoryList.push(deleted);
        this.addRepositoryToProviders(deleted).catch(error => log.warn(error.message));
        throw err;
      }
    }
  }

  // PROVIDERS

  async addProvider(name, provider) {
    if (provider && typeof provider.getRepositories === 'function') {
      this.providers[name] = provider;
      this.repositoryList = await updateRepoListWithReposFromProviders(this.providers, this.repositoryList, this.repositoryFile);
    }
  }

  addRepositoryToProviders(repo) {
    const promises = [];
    for (const provider of Object.values(this.providers)) {
      if (typeof provider.canHandle === 'function') {
        // make a new copy to for each provider to be invoked with
        // in case any provider modifies it (which they shouldn't do)
        const copy = Object.assign({}, repo);
        if (provider.canHandle(copy) && typeof provider.addRepository === 'function')
          promises.push(provider.addRepository(copy));
      }
    }
    return Promise.all(promises);
  }

  removeRepositoryFromProviders(repo) {
    const promises = [];
    for (const provider of Object.values(this.providers)) {
      if (typeof provider.canHandle === 'function') {
        // make a new copy to for each provider to be invoked with
        // in case any provider modifies it (which they shouldn't do)
        const copy = Object.assign({}, repo);
        if (provider.canHandle(copy) && typeof provider.removeRepository === 'function')
          promises.push(provider.removeRepository(copy));
      }
    }
    return Promise.all(promises);
  }
}

// FUNCTIONS

// Save the default list to disk so the user can potentially edit it (WHEN CODEWIND IS NOT RUNNING)
async function writeRepositoryList(repositoryFile, repositoryList) {
  await fs.ensureFile(repositoryFile);
  await fs.writeJson(repositoryFile, repositoryList, { spaces: '  ' });
  log.info(`Repository list updated.`);
}

function getRepositoryIndex(url, repositories) {
  const index = repositories.findIndex(repo => repo.url === url);
  return index;
}

async function updateRepoListWithReposFromProviders(providers, repositoryList, repositoryFile) {
  const providedRepos = await getReposFromProviders(Object.values(providers));
  
  const extraRepos = providedRepos.filter(repo =>
    !repositoryList.find(repo2 => repo2.url === repo.url)
  );
  if (extraRepos.length > 0) {
    
    const reposWithCodewindSettings = await Promise.all(
      extraRepos.map(async repo => {
        repo.enabled = true;
        repo.protected = true;
        const repoWithTemplateStyles = await fetchRepositoryDetails(repo);
        return repoWithTemplateStyles;
      })
    );
    const updatedRepositoryList = repositoryList.concat(reposWithCodewindSettings);
    await writeRepositoryList(repositoryFile, updatedRepositoryList);
    return updatedRepositoryList;
  }
  return repositoryList;
}

function fetchAllRepositoryDetails(repos) {
  return Promise.all(
    repos.map(repo => fetchRepositoryDetails(repo))
  );
}

async function fetchRepositoryDetails(repo) {
  let newRepo = {...repo}

  // Only set the name or description of the repo if not given by the user
  if (!(repo.name && repo.description)){
    newRepo = await readRepoTemplatesJSON(newRepo);
  }

  if (repo.projectStyles) {
    return newRepo;
  }

  const templatesFromRepo = await getTemplatesFromRepo(repo);
  newRepo.projectStyles = getTemplateStyles(templatesFromRepo);
  return newRepo;
}

async function readRepoTemplatesJSON(repository) {
  if (!repository.url) {
    throw new Error(`repository must have a URL`);
  }

  const indexUrl = new URL(repository.url);
  // return repository untouched if repository url points to a local file
  if ( indexUrl.protocol === 'file:' ) {
    return repository;
  }
  const indexPath = indexUrl.pathname;
  const templatesPath = path.dirname(indexPath) + '/' + 'templates.json';

  const templatesUrl = new URL(repository.url);
  templatesUrl.pathname = templatesPath;

  const options = {
    host: templatesUrl.host,
    path: templatesUrl.pathname,
    method: 'GET',
  }

  const res = await cwUtils.asyncHttpRequest(options, undefined, templatesUrl.protocol === 'https:');
  if (res.statusCode !== 200) {
    // Return repository untouched as templates.json may not exist.
    return repository;
  }

  try {
    const templateDetails = JSON.parse(res.body);
    const updatedRepository = repository;
    for (const prop of ['name', 'description']) {
      if (templateDetails.hasOwnProperty(prop)) {
        repository[prop] = templateDetails[prop];
      }
    }
    return updatedRepository;
  } catch (error) {
    // Log an error but don't throw an exception as this is optional.
    log.error(`URL '${templatesUrl}' should return JSON`);
  }
  return repository;
}

async function getTemplatesFromRepos(repos) {
  let newProjectTemplates = [];
  await Promise.all(repos.map(async(repo) => {
    try {
      const extraTemplates = await getTemplatesFromRepo(repo);
      newProjectTemplates = newProjectTemplates.concat(extraTemplates);
    } catch (err) {
      log.warn(`Error accessing template repository '${repo.url}'. Error: ${util.inspect(err)}`);
      // Ignore to keep trying other repositories
    }
  }));
  newProjectTemplates.sort((a, b) => {
    return a.label.localeCompare(b.label);
  });
  return newProjectTemplates;
}

async function getTemplatesFromRepo(repository) {
  if (!repository.url) {
    throw new Error(`repo '${repository}' must have a URL`);
  }

  const templateSummaries = await getJSONFromURL(repository.url);

  const templates = templateSummaries.map(summary => {
    const template = {
      label: summary.displayName,
      description: summary.description,
      language: summary.language,
      url: summary.location,
      projectType: summary.projectType,
    };

    if (summary.projectStyle) {
      template.projectStyle = summary.projectStyle;
    }
    if (repository.name) {
      template.source = repository.name;
    }
    if (repository.id) {
      template.sourceId = repository.id;
    }

    return template;
  });
  return templates;
}

async function getJSONFromURL(givenURL) {
  const parsedURL = new URL(givenURL);
  let templateSummaries;
  // check if repository url points to a local file and read it accordingly
  if (parsedURL.protocol === 'file:') {
    try {
      if (await fs.pathExists(parsedURL.pathname) ) {
        templateSummaries = await fs.readJSON(parsedURL.pathname);
      }
    } catch (err) {
      throw new Error(`repo file '${parsedURL}' should return json`);
    }
  } else {
    const options = {
      host: parsedURL.host,
      path: parsedURL.pathname,
      method: 'GET',
    }
    const res = await cwUtils.asyncHttpRequest(options, undefined, parsedURL.protocol === 'https:');
    if (res.statusCode !== 200) {
      throw new Error(`Unexpected HTTP status for ${givenURL}: ${res.statusCode}`);
    }
    try {
      templateSummaries = JSON.parse(res.body);
    } catch (error) {
      throw new Error(`URL '${parsedURL}' should return JSON`);
    }
  }
  return templateSummaries;
}

function filterTemplatesByStyle(templates, projectStyle) {
  const relevantTemplates = templates.filter(template =>
    getTemplateStyle(template) === projectStyle
  );
  return relevantTemplates;
}

function getTemplateStyles(templates) {
  const styles = templates.map(template => getTemplateStyle(template));
  const uniqueStyles = [...new Set(styles)];
  return uniqueStyles;
}

function getTemplateStyle(template) {
  // if a project's style isn't specified, it defaults to 'Codewind'
  return template.projectStyle || 'Codewind';
}

async function getReposFromProviders(providers) {
  const repos = [];
  await Promise.all(providers.map(async(provider) => {
    try {
      const providedRepos = await provider.getRepositories();
      if (!Array.isArray(providedRepos)) {
        throw new Error (`provider ${util.inspect(provider)} should provide an array of repos, but instead provided '${providedRepos}'`);
      }
      providedRepos.forEach(repo => {
        if (isRepo(repo)) {
          repos.push(repo);
        }
      })
    }
    catch (err) {
      log.error(err.message);
    }
  }));
  return repos;
}

function isRepo(obj) {
  return Boolean((obj && obj.hasOwnProperty('url')));
}

async function doesURLPointToIndexJSON(inputUrl) {
  try {
    const templateSummaries = await getJSONFromURL(inputUrl);
    if (templateSummaries.some(summary => !isTemplateSummary(summary))) {
      return false;
    }
  } catch(error) {
    log.warn(error);
    return false
  }
  return true;
}

function isTemplateSummary(obj) {
  const expectedKeys = ['displayName', 'description', 'language', 'projectType', 'location', 'links'];
  return expectedKeys.every(key => obj.hasOwnProperty(key));
}