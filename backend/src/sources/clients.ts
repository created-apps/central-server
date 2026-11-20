import { config } from "../config.js";
import { ReadOnlySource } from "./postgrest.js";

export const syncSource = new ReadOnlySource("SYNC", config.sync.url, config.sync.key);
export const cosmicSource = new ReadOnlySource("COSMIC", config.cosmic.url, config.cosmic.key);
export const automationsSource = new ReadOnlySource("AUTOMATIONS", config.automations.url, config.automations.key);
