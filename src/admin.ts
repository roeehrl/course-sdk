import type { Json, ValidationIssue } from './types.js';
import type { AdminPermission, AdminSection, AdminSetting } from './contracts-types.js';

/**
 * Schema-driven admin settings. A host renders a section's settings from `adminSettingsSchema`
 * and enforces every change on the server with `checkAdminSettingChange`; the section's
 * declarations never grant authority by themselves.
 */
export function adminSettingsSchema(section: AdminSection): Record<string, Json> {
  const properties: Record<string, Json> = {};
  for (const setting of section.settings) {
    const common: Record<string, Json> = { title: setting.label, default: setting.default, 'x-scope': setting.scope, 'x-mutationPermission': setting.mutationPermission };
    if (setting.description !== undefined) common.description = setting.description;
    switch (setting.type) {
      case 'boolean': properties[setting.id] = { ...common, type: 'boolean' }; break;
      case 'integer': case 'number': properties[setting.id] = { ...common, type: setting.type, minimum: setting.minimum, maximum: setting.maximum }; break;
      case 'string': properties[setting.id] = { ...common, type: 'string', maxLength: setting.maxLength }; break;
      case 'enum': properties[setting.id] = { ...common, type: 'string', enum: [...setting.options] }; break;
    }
  }
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title: section.title, type: 'object', additionalProperties: false, properties };
}

/** The default value of every setting in a section. */
export function adminSettingDefaults(section: AdminSection): Record<string, Json> {
  return Object.fromEntries(section.settings.map(setting => [setting.id, setting.default]));
}

export interface AdminSettingChange { settingId: string; value: unknown; scope: AdminSetting['scope'] }

function valueIssue(setting: AdminSetting, value: unknown): string | undefined {
  switch (setting.type) {
    case 'boolean': return typeof value === 'boolean' ? undefined : 'Expected true or false.';
    case 'integer': case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (setting.type === 'integer' && !Number.isInteger(value))) return `Expected ${setting.type === 'integer' ? 'a whole number' : 'a number'}.`;
      return value < setting.minimum || value > setting.maximum ? `Expected a value from ${setting.minimum} to ${setting.maximum}.` : undefined;
    case 'string': return typeof value !== 'string' ? 'Expected text.' : value.length > setting.maxLength ? `Expected at most ${setting.maxLength} characters.` : undefined;
    case 'enum': return typeof value === 'string' && setting.options.includes(value) ? undefined : `Expected one of ${setting.options.join(', ')}.`;
  }
}

/**
 * Server-side check of one admin setting change against the declared section and the
 * permissions the host granted to the actor. Every section permission and the setting's
 * mutation permission must be granted. An empty result means the change may be applied
 * and audited; the host still authenticates the actor and records the audit entry.
 */
export function checkAdminSettingChange(section: AdminSection, change: AdminSettingChange, granted: readonly AdminPermission[]): ValidationIssue[] {
  const setting = section.settings.find(s => s.id === change.settingId);
  if (!setting) return [{ code: 'UNKNOWN_SETTING', path: '/settingId', message: `Section ${section.id} declares no setting ${change.settingId}.` }];
  const issues: ValidationIssue[] = [];
  const missing = [...new Set([...section.requiredPermissions, setting.mutationPermission])].filter(p => !granted.includes(p));
  if (missing.length) issues.push({ code: 'ADMIN_PERMISSION_DENIED', path: '/settingId', message: `Missing permission: ${missing.join(', ')}.` });
  if (change.scope !== setting.scope) issues.push({ code: 'SETTING_SCOPE_MISMATCH', path: '/scope', message: `${setting.id} is set at ${setting.scope} scope.` });
  const invalid = valueIssue(setting, change.value);
  if (invalid) issues.push({ code: 'INVALID_SETTING_VALUE', path: '/value', message: invalid });
  return issues;
}
