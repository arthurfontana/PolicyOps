import { describeRoleRequirement, minRoleForCommand, roleAtLeast } from '@/core/document/roles';
import type { Role } from '@/core/document/schema';
import { useDocumentStore } from '@/store/document-store';

/** Papel efetivo da identidade atual no documento aberto (docs/14 §6). */
export function useEffectiveRole(): Role {
  return useDocumentStore((s) => s.effectiveRole());
}

/**
 * Se um comando de `commandType` seria aceito agora, e o motivo pronto em
 * pt-BR para desabilitar a ação quando não seria ("Requer papel PUBLISHER —
 * você é EDITOR.", docs/14 §6).
 */
export function useRoleGate(commandType: string): {
  allowed: boolean;
  required: Role;
  effective: Role;
  reason: string | null;
} {
  const effective = useEffectiveRole();
  const required = minRoleForCommand(commandType);
  const allowed = roleAtLeast(effective, required);
  return { allowed, required, effective, reason: allowed ? null : describeRoleRequirement(required, effective) };
}
