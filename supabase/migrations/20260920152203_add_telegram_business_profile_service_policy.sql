create policy "Service role manages Telegram business profiles"
on public.telegram_business_profiles
for all
to service_role
using (true)
with check (true);
