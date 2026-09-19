export interface PipelineWorkerDeployment {
  version: string;
  projectId: string;
  environmentId: string;
}

const BINDING_FIELDS = ["version", "projectId", "environmentId"] as const;

function exactText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`pipeline worker deployment ${field} must be an exact nonblank trimmed string`);
  }
  return value;
}

export function normalizePipelineWorkerDeployment(value: unknown): PipelineWorkerDeployment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pipeline worker deployment binding is invalid");
  }
  const binding = value as Record<string, unknown>;
  if (Object.keys(binding).some((key) => !BINDING_FIELDS.some((field) => field === key))) {
    throw new Error("pipeline worker deployment binding contains unknown fields");
  }
  return {
    version: exactText(binding.version, "version"),
    projectId: exactText(binding.projectId, "projectId"),
    environmentId: exactText(binding.environmentId, "environmentId"),
  };
}

export function pipelineWorkerDeploymentDispatchOptions(
  binding?: PipelineWorkerDeployment,
): { version?: string } {
  return binding === undefined ? {} : { version: normalizePipelineWorkerDeployment(binding).version };
}

export function assertPipelineWorkerDeployment(
  expected: PipelineWorkerDeployment,
  actual: PipelineWorkerDeployment,
): void {
  const normalizedExpected = normalizePipelineWorkerDeployment(expected);
  const normalizedActual = normalizePipelineWorkerDeployment(actual);
  for (const field of BINDING_FIELDS) {
    if (normalizedExpected[field] !== normalizedActual[field]) {
      throw new Error(`pipeline worker deployment ${field} mismatch`);
    }
  }
}

export function resolvePipelineWorkerDeployment(input: {
  workerVersion?: string;
  projectId: string;
  environmentId: string;
  runVersion?: string;
  deploymentVersion?: string;
}): PipelineWorkerDeployment {
  const binding = normalizePipelineWorkerDeployment({
    version: input.workerVersion,
    projectId: input.projectId,
    environmentId: input.environmentId,
  });
  for (const field of ["runVersion", "deploymentVersion"] as const) {
    const version = input[field];
    if (version !== undefined && exactText(version, field) !== binding.version) {
      throw new Error(`pipeline worker deployment ${field} mismatch`);
    }
  }
  return binding;
}
