import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";

const config = getServerConfigFromServer();

export function getOtelResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "globalwars",
    [ATTR_SERVICE_VERSION]: "1.0.0",
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  return {
    "service.instance.id": process.env.HOSTNAME,
    "globalwars.environment": config.env(),
    "globalwars.host": process.env.HOST,
    "globalwars.domain": process.env.DOMAIN,
    "globalwars.subdomain": process.env.SUBDOMAIN,
    "globalwars.component": process.env.WORKER_ID
      ? "Worker " + process.env.WORKER_ID
      : "Master",
  };
}
