import Builder, { mode } from "../Query/Builder"
import { eagerNode } from "../Query/EagerUtils"

export default function FindWithinDistance(neode, model, location_property, point, distance, properties, extraEagerNames, order, limit, skip, customerId) {
  const alias = "this"

  const builder = new Builder(neode)

  // Match
  builder.match(alias, model, undefined, customerId)

  // Where
  if (properties) {
    Object.keys(properties).forEach(key => {
      builder.where(`${alias}.${key}`, properties[key])
    })
  }

  // Prefix key on Properties
  if (properties) {
    Object.keys(properties).forEach(key => {
      properties[`${alias}.${key}`] = properties[key]

      delete properties[key]
    })
  }

  // Distance from Point
  // TODO: When properties are passed match them as well .where(properties);
  let pointString = Number.isNaN(point.x) ? `latitude:${point.latitude}, longitude:${point.longitude}` : `x:${point.x}, y:${point.y}`
  if (!Number.isNaN(point.z)) {
    pointString += `, z:${point.z}`
  }

  if (!Number.isNaN(point.height)) {
    pointString += `, height:${point.height}`
  }

  builder.whereRaw(`distance (this.${location_property}, point({${pointString}})) <= ${distance}`)

  // Order
  if (typeof order === "string") {
    order = `${alias}.${order}`
  } else if (typeof order === "object") {
    Object.keys(order).forEach(key => {
      builder.orderBy(`${alias}.${key}`, order[key])
    })
  }

  // Output
  const output = eagerNode(neode, 1, alias, model, extraEagerNames, customerId)

  // Complete Query
  return builder
    .orderBy(order)
    .skip(skip)
    .limit(limit)
    .return(output)
    .execute(mode.READ)
    .then(res => neode.hydrate(res, alias, model, extraEagerNames))
}
