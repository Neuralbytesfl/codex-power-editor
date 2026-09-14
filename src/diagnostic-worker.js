import { parentPort, workerData } from "node:worker_threads";
import { analyzeText } from "./diagnostics.js";
parentPort.postMessage(analyzeText(workerData.text));
