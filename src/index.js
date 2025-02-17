/* eslint-disable import/no-dynamic-require */
/* eslint-disable new-cap */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable global-require */
/* eslint-disable import/no-import-module-exports */
import fs from "fs"
import neo4j from "neo4j-driver"
import path from "path"
import Collection from "./Collection"
import { valueToCypher } from "./Entity"
import Factory from "./Factory"
import Model from "./Model"
import ModelMap from "./ModelMap"
import Builder from "./Query/Builder"
import Schema from "./Schema"
import DeleteRelationshipByProperties from "./Services/DeleteRelationshipByProperties"
import RelateByProperties from "./Services/RelateByProperties"
import TransactionError from "./TransactionError"

export { Builder }

export default class Neode {
  /**
   * Constructor
   *
   * @param  {String} connection_string
   * @param  {String} username
   * @param  {String} password
   * @param  {Bool}   enterprise
   * @param  {String} database
   * @param  {Object} config
   * @return {Neode}
   */
  constructor(connection_string, username, password, enterprise = false, database = undefined, config = {}) {
    const auth = username && password ? neo4j.auth.basic(username, password) : null
    this.driver = new neo4j.driver(connection_string, auth, config)
    this.models = new ModelMap(this)
    this.schema = new Schema(this)
    this.factory = new Factory(this)

    this.database = database

    this.setEnterprise(enterprise)
  }

  /**
   * @static
   * Generate Neode instance using .env configuration
   *
   * @return {Neode}
   */
  static fromEnv() {
    require("dotenv").config()

    const connection_string = `${process.env.NEO4J_PROTOCOL}://${process.env.NEO4J_HOST}:${process.env.NEO4J_PORT}`
    const username = process.env.NEO4J_USERNAME
    const password = process.env.NEO4J_PASSWORD
    const enterprise = process.env.NEO4J_ENTERPRISE === "true"

    // Multi-database
    const database = process.env.NEO4J_DATABASE || "neo4j"

    // Build additional config
    const config = {}

    const settings = {
      NEO4J_ENCRYPTION: "encrypted",
      NEO4J_TRUST: "trust",
      NEO4J_TRUSTED_CERTIFICATES: "trustedCertificates",
      NEO4J_KNOWN_HOSTS: "knownHosts",

      NEO4J_MAX_CONNECTION_POOLSIZE: "maxConnectionPoolSize",
      NEO4J_MAX_TRANSACTION_RETRY_TIME: "maxTransactionRetryTime",
      NEO4J_LOAD_BALANCING_STRATEGY: "loadBalancingStrategy",
      NEO4J_MAX_CONNECTION_LIFETIME: "maxConnectionLifetime",
      NEO4J_CONNECTION_TIMEOUT: "connectionTimeout",
      NEO4J_DISABLE_LOSSLESS_INTEGERS: "disableLosslessIntegers",
      NEO4J_LOGGING_LEVEL: "logging",
    }

    Object.keys(settings).forEach(setting => {
      if (process.env.hasOwnProperty(setting)) {
        const key = settings[setting]
        let value = process.env[setting]

        if (key == "trustedCertificates") {
          value = value.split(",")
        } else if (key == "disableLosslessIntegers") {
          value = value === "true"
        }

        config[key] = value
      }
    })

    return new Neode(connection_string, username, password, enterprise, database, config)
  }

  static getCustomerIdLabel(customerId) {
    return `cid_${customerId.replace(/-/g, "_")}`
  }

  static getCustomerIdFromNodeLabels(nodeOrLabelArr) {
    const labels = Array.isArray(nodeOrLabelArr) ? nodeOrLabelArr : nodeOrLabelArr.labels()
    const label = labels.find(label => label.startsWith("cid_"))
    return label ? label.replace("cid_", "").replace(/_/g, "-") : null
  }

  static propertiesToCypher(model, properties) {
    const resObj = {}

    model.properties().forEach(property => {
      const name = property.name()

      // Skip if not set
      if (!properties.hasOwnProperty(name)) {
        return
      }

      const value = valueToCypher(property, properties[name])

      if (value !== undefined) {
        resObj[name] = value
      }
    })

    return resObj
  }

  /**
   * Define multiple models
   *
   * @param  {Object} models   Map of models with their schema.  ie {Movie: {...}}
   * @return {Neode}
   */
  with(models) {
    Object.keys(models).forEach(model => {
      this.model(model, models[model])
    })

    return this
  }

  /**
   * Scan a directory for Models
   *
   * @param  {String} directory   Directory to scan
   * @return {Neode}
   */
  withDirectory(directory) {
    const files = fs.readdirSync(directory)

    files
      .filter(file => path.extname(file).toLowerCase() === ".js")
      .forEach(file => {
        const model = file.replace(".js", "")
        const path = `${directory}/${file}`
        const schema = require(`${path}`)

        return this.model(model, schema)
      })

    return this
  }

  /**
   * Set the default database for all future connections
   *
   * @param {String} database
   */
  setDatabase(database) {
    this.database = database
  }

  /**
   * Set Enterprise Mode
   *
   * @param {Bool} enterprise
   */
  setEnterprise(enterprise) {
    this._enterprise = enterprise
  }

  /**
   * Are we running in enterprise mode?
   *
   * @return {Bool}
   */
  enterprise() {
    return this._enterprise
  }

  /**
   * Define a new Model
   *
   * @param  {String} name
   * @param  {Object} schema
   * @return {Model}
   */
  model(name, schema) {
    if (schema instanceof Object) {
      const model = new Model(this, name, schema)
      this.models.set(name, model)
    }

    if (!this.models.has(name)) {
      const defined = this.models.keys()

      let message = `Couldn't find a definition for "${name}".`

      if (defined.length == 0) {
        message += " It looks like no models have been defined."
      } else {
        message += ` The models currently defined are [${defined.join(", ")}]`
      }

      throw new Error(message)
    }

    return this.models.get(name)
  }

  /**
   * Extend a model with extra configuration
   *
   * @param  {String} name   Original Model to clone
   * @param  {String} as     New Model name
   * @param  {Object} using  Schema changes
   * @return {Model}
   */
  extend(model, as, using) {
    return this.models.extend(model, as, using)
  }

  /**
   * Create a new Node of a type
   *
   * @param  {String} model
   * @param  {Object} properties
   * @param  {String|null} customerId
   * @return {Node}
   */
  create(model, properties, customerId) {
    return this.models.get(model).create(properties, customerId)
  }

  /**
   * Merge a node based on the defined indexes
   *
   * @param  {Object} properties
   * @param  {String|null} customerId
   * @return {Promise}
   */
  merge(model, properties, customerId) {
    return this.model(model).merge(properties, customerId)
  }

  /**
   * Merge a node based on the supplied properties
   *
   * @param  {Object} match Specific properties to merge on
   * @param  {Object} set   Properties to set
   * @param  {String|null} customerId
   * @return {Promise}
   */
  mergeOn(model, match, set, customerId) {
    return this.model(model).mergeOn(match, set, customerId)
  }

  /**
   * Delete a Node from the graph
   *
   * @param  {Node} node
   * @return {Promise}
   */
  delete(node) {
    return node.delete()
  }

  /**
   * Delete all node labels
   *
   * @param  {String} label
   * @return {Promise}
   */
  deleteAll(model) {
    return this.models.get(model).deleteAll()
  }

  /**
   * Relate two nodes based on the type
   *
   * @param  {Node}   from        Origin node
   * @param  {Node}   to          Target node
   * @param  {String} type        Type of Relationship definition
   * @param  {Object} properties  Properties to set against the relationships
   * @param  {Boolean} force_create   Force the creation a new relationship? If false, the relationship will be merged
   * @return {Promise}
   */
  relate(from, to, type, properties, force_create = false) {
    return from.relateTo(to, type, properties, force_create)
  }

  /**
   * Relate two nodes based on the type and properties
   *
   * @param  {Model}  fromModel               Origin model
   * @param  {Object} fromProperties          Origin properties
   * @param  {String} type                    Type of Relationship definition
   * @param  {Model}  toModel                 Target model
   * @param  {Object} toProperties            Target properties
   * @param  {Object} reltionshipProperties   Relationship properties
   * @param  {String} customerId              Customer id
   * @return {Promise}
   */
  relateByProperties(fromModel, fromProperties, type, toModel, toProperties, reltionshipProperties, customerId) {
    return RelateByProperties(this, fromModel, fromProperties, type, toModel, toProperties, reltionshipProperties, customerId)
  }

  /**
   * Delete relationship between nodes found by properties
   *
   * @param  {Model}  fromModel               Origin model
   * @param  {Object} fromProperties          Origin properties
   * @param  {String} type                    Type of Relationship definition
   * @param  {Model}  toModel                 Target model
   * @param  {Object} toProperties            Target properties
   * @param  {String} customerId              Customer id
   * @return {Promise}
   */
  deleteRelationshipByProperties(fromModel, fromProperties, type, toModel, toProperties, customerId) {
    return DeleteRelationshipByProperties(this, fromModel, fromProperties, type, toModel, toProperties, customerId)
  }

  /**
   * Run an explicitly defined Read query
   *
   * @param  {String} query
   * @param  {Object} params
   * @return {Promise}
   */
  readCypher(query, params) {
    const session = this.readSession()

    return this.cypher(query, params, session)
  }

  /**
   * Run an explicitly defined Write query
   *
   * @param  {String} query
   * @param  {Object} params
   * @return {Promise}
   */
  writeCypher(query, params) {
    const session = this.writeSession()

    return this.cypher(query, params, session)
  }

  /**
   * Run a Cypher query
   *
   * @param  {String} query
   * @param  {Object} params
   * @return {Promise}
   */
  cypher(query, params, session = false) {
    // If single run, open a new session
    const single = !session
    if (single) {
      session = this.session()
    }

    return session
      .run(query, params)
      .then(res => {
        if (single) {
          session.close()
        }

        return res
      })
      .catch(err => {
        if (single) {
          session.close()
        }

        err.query = query
        err.params = params

        throw err
      })
  }

  /**
   * Create a new Session in the Neo4j Driver.
   *
   * @param {String} database
   * @return {Session}
   */
  session(database = this.database) {
    return this.readSession(database)
  }

  /**
   * Create an explicit Read Session
   *
   * @param {String} database
   * @return {Session}
   */
  readSession(database = this.database) {
    return this.driver.session({
      database,
      defaultAccessMode: neo4j.session.READ,
    })
  }

  /**
   * Create an explicit Write Session
   *
   * @param {String} database
   * @return {Session}
   */
  writeSession(database = this.database) {
    return this.driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    })
  }

  /**
   * Create a new Transaction
   *
   * @return {Transaction}
   */
  transaction(mode = neo4j.WRITE, database = this.database) {
    const session = this.driver.session(database)
    const tx = session.beginTransaction(mode)

    // Create an 'end' function to commit & close the session
    // TODO: Clean up
    tx.success = () =>
      tx.commit().then(() => {
        session.close()
      })

    return tx
  }

  /**
   * Run a batch of queries within a transaction
   *
   * @type {Array}
   * @return {Promise}
   */
  batch(queries) {
    const tx = this.transaction()
    const output = []
    const errors = []

    return Promise.all(
      queries.map(query => {
        const params = typeof query === "object" ? query.params : {}
        query = typeof query === "object" ? query.query : query

        try {
          return tx
            .run(query, params)
            .then(res => {
              output.push(res)
            })
            .catch(error => {
              errors.push({ query, params, error })
            })
        } catch (error) {
          errors.push({ query, params, error })
          return undefined
        }
      }),
    ).then(() => {
      if (errors.length) {
        tx.rollback()

        const error = new TransactionError(errors)

        throw error
      }

      return tx.success().then(() => output)
    })
  }

  /**
   * Close Driver
   *
   * @return {void}
   */
  close() {
    this.driver.close()
  }

  /**
   * Return a new Query Builder
   *
   * @return {Builder}
   */
  query() {
    return new Builder(this)
  }

  /**
   * Get a collection of nodes`
   *
   * @param  {String}              label
   * @param  {Object}              properties
   * @param  {String|Array|Object} order
   * @param  {Int}                 limit
   * @param  {Int}                 skip
   * @param  {String|null} customerId
   * @return {Promise}
   */
  all(label, properties, order, limit, skip, customerId) {
    return this.models.get(label).all(properties, order, limit, skip, customerId)
  }

  /**
   * Find a Node by it's label and primary key
   *
   * @param  {String} label
   * @param  {mixed}  id
   * @param  {String|null} customerId
   * @return {Promise}
   */
  find(label, id, customerId) {
    return this.models.get(label).find(id, customerId)
  }

  /**
   * Find a Node by it's internal node ID
   *
   * @param  {String} model
   * @param  {int}    id
   * @param  {String|null} customerId
   * @return {Promise}
   */
  findById(label, id, customerId) {
    return this.models.get(label).findById(id, customerId)
  }

  /**
   * Find a Node by properties
   *
   * @param  {String} label
   * @param  {Object}  key     Object of values
   * @param  {String|null} customerId
   * @return {Promise}
   */
  first(label, properties, customerId) {
    return this.models.get(label).first(properties, customerId)
  }

  /**
   * Hydrate a set of nodes and return a Collection
   *
   * @param  {Object}          res            Neo4j result set
   * @param  {String}          alias          Alias of node to pluck
   * @param  {Definition|null} definition     Force Definition
   * @return {Collection}
   */
  hydrate(res, alias, definition, extraEagerNames) {
    return this.factory.hydrate(res, alias, definition, extraEagerNames)
  }

  /**
   * Hydrate the first record in a result set
   *
   * @param  {Object} res    Neo4j Result
   * @param  {String} alias  Alias of Node to pluck
   * @return {Node}
   */
  hydrateFirst(res, alias, definition, extraEagerNames) {
    return this.factory.hydrateFirst(res, alias, definition, extraEagerNames)
  }

  /**
   * Turn an array into a Collection
   *
   * @param  {Array} array An array
   * @return {Collection}
   */
  toCollection(array) {
    return new Collection(this, array)
  }
}
