revoke all privileges on table
  public.telegram_admins,
  public.telegram_daily_usage,
  public.telegram_owned_bots,
  public.telegram_subscription_payments,
  public.telegram_subscriptions,
  public.telegram_user_settings,
  public.telegram_web_link_states,
  public.telegram_web_links,
  public.tivals_web_oauth_connections,
  public.tivals_web_oauth_states
from anon, authenticated;

grant all privileges on table
  public.telegram_admins,
  public.telegram_daily_usage,
  public.telegram_owned_bots,
  public.telegram_subscription_payments,
  public.telegram_subscriptions,
  public.telegram_user_settings,
  public.telegram_web_link_states,
  public.telegram_web_links,
  public.tivals_web_oauth_connections,
  public.tivals_web_oauth_states
to service_role;
