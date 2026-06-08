import type { ChatSessionMode, MediaExecutionPolicy } from '@open-design/contracts';
import type { ProjectMetadata } from '../types';

function cleanModel(model: unknown): string {
  return typeof model === 'string' ? model.trim() : '';
}

export function mediaExecutionPolicyForProjectMetadata(
  metadata: ProjectMetadata | null | undefined,
  sessionMode: ChatSessionMode = 'design',
): MediaExecutionPolicy | undefined {
  if (!metadata) return undefined;
  const mode = sessionMode === 'chat' ? 'question' : 'enabled';
  if (metadata.kind === 'image') {
    const model = cleanModel(metadata.imageModel);
    return model
      ? { mode, allowedSurfaces: ['image'], allowedModels: [model] }
      : { mode, allowedSurfaces: ['image'] };
  }
  if (metadata.kind === 'video') {
    const model = cleanModel(metadata.videoModel);
    return model
      ? { mode, allowedSurfaces: ['video'], allowedModels: [model] }
      : { mode, allowedSurfaces: ['video'] };
  }
  if (metadata.kind === 'audio') {
    const model = cleanModel(metadata.audioModel);
    return model
      ? { mode, allowedSurfaces: ['audio'], allowedModels: [model] }
      : { mode, allowedSurfaces: ['audio'] };
  }
  return undefined;
}
