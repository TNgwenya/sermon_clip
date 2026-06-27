import { pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = process.cwd();

function resolveTsCandidate(specifier) {
  if (specifier.startsWith("@/")) {
    return pathToFileURL(path.join(projectRoot, "src", specifier.slice(2) + ".ts")).href;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const mapped = resolveTsCandidate(specifier);
  if (mapped) {
    return {
      shortCircuit: true,
      url: mapped,
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      (specifier.startsWith("../") || specifier.startsWith("./")) &&
      !path.extname(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }

    throw error;
  }
}
