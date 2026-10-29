-- Channel accounts (review round 2): inbound WhatsApp is routed by external_account_id (webhooks store.ts) and the
-- worker reads the Vault secret named by secret_id. With table-wide INSERT/UPDATE, an owner could PATCH either
-- through the API: claim another business's WhatsApp number and receive its customers' replies, or point the
-- account at a Vault secret that is not theirs. Client roles now write only tenant_id, channel, config and enabled
-- (RLS still limits that to owners). external_account_id is set by trusted code after Meta confirms the number
-- with the tenant's own token (apps/web/lib/trusted/admin.ts setChannelConfig); secret_id by set_channel_secret.
revoke insert, update on table public.channel_accounts from authenticated;
grant insert (tenant_id, channel, config, enabled) on table public.channel_accounts to authenticated;
grant update (config, enabled) on table public.channel_accounts to authenticated;
