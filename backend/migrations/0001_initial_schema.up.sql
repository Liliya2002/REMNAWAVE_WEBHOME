-- Migration: 0001_initial_schema
-- Up
--
-- Полная схема БД (squashed v1.0 baseline).
-- Получена через pg_dump после применения старых 22 миграций (0001-0022),
-- объединённых в одну для упрощения первого деплоя на production.
--
-- Дата создания: 2026-04-26 19:54:59 UTC
--
-- На свежей БД: применяется как обычно.
-- На существующей БД: пометьте как применённую через "node scripts/migrate.js bootstrap".

SET client_encoding = 'UTF8';
SET statement_timeout = 0;
SET lock_timeout = 0;
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--

CREATE FUNCTION public.generate_referral_code_func() RETURNS character varying
    LANGUAGE plpgsql
    AS $$

DECLARE

  code VARCHAR(20);

  code_exists BOOLEAN;

BEGIN

  LOOP

    code := 'ref_' || SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FOR 10);

    SELECT EXISTS(SELECT 1 FROM referral_links WHERE code = gen_code.code) INTO code_exists;

    IF NOT code_exists THEN

      RETURN code;

    END IF;

  END LOOP;

END;

$$;

CREATE FUNCTION public.update_referral_config_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$$;

CREATE FUNCTION public.update_referrals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$$;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.admin_audit_log (
    id bigint NOT NULL,
    admin_id integer,
    admin_login character varying(64),
    action character varying(64) NOT NULL,
    target_type character varying(32),
    target_id character varying(128),
    changes jsonb DEFAULT '{}'::jsonb,
    ip character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.admin_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.admin_audit_log_id_seq OWNED BY public.admin_audit_log.id;

CREATE TABLE public.admin_broadcasts (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    type character varying(50) DEFAULT 'info'::character varying,
    target character varying(50) DEFAULT 'all'::character varying,
    recipients_count integer DEFAULT 0,
    created_by integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.admin_broadcasts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.admin_broadcasts_id_seq OWNED BY public.admin_broadcasts.id;

CREATE TABLE public.config_history (
    id integer NOT NULL,
    changed_by integer,
    template_id integer,
    action character varying(50),
    changes jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.config_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.config_history_id_seq OWNED BY public.config_history.id;

CREATE TABLE public.email_verifications (
    id integer NOT NULL,
    email character varying(128) NOT NULL,
    code character varying(6) NOT NULL,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval)
);

CREATE SEQUENCE public.email_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.email_verifications_id_seq OWNED BY public.email_verifications.id;

CREATE TABLE public.hosting_offers_cache (
    id integer NOT NULL,
    offer_key character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    location character varying(255) DEFAULT ''::character varying,
    provider character varying(255) DEFAULT ''::character varying,
    cpu integer DEFAULT 0,
    ram_gb numeric(10,2) DEFAULT 0,
    disk_gb numeric(10,2) DEFAULT 0,
    bandwidth_tb numeric(10,2) DEFAULT 0,
    price_monthly numeric(12,2) DEFAULT 0,
    currency character varying(10) DEFAULT 'USD'::character varying,
    stock_status character varying(50) DEFAULT 'unknown'::character varying,
    is_active boolean DEFAULT true,
    source_updated_at timestamp with time zone,
    raw jsonb DEFAULT '{}'::jsonb,
    last_synced_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.hosting_offers_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.hosting_offers_cache_id_seq OWNED BY public.hosting_offers_cache.id;

CREATE TABLE public.hosting_sync_logs (
    id integer NOT NULL,
    status character varying(20) NOT NULL,
    message text DEFAULT ''::text,
    fetched_count integer DEFAULT 0,
    changed_count integer DEFAULT 0,
    source_url text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.hosting_sync_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.hosting_sync_logs_id_seq OWNED BY public.hosting_sync_logs.id;

CREATE TABLE public.landing_page_audit (
    id bigint NOT NULL,
    landing_id integer,
    user_id integer,
    action character varying(40) NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.landing_page_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.landing_page_audit_id_seq OWNED BY public.landing_page_audit.id;

CREATE TABLE public.landing_page_visits (
    id bigint NOT NULL,
    landing_id integer NOT NULL,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent character varying(255),
    referrer character varying(500)
);

CREATE SEQUENCE public.landing_page_visits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.landing_page_visits_id_seq OWNED BY public.landing_page_visits.id;

CREATE TABLE public.landing_pages (
    id integer NOT NULL,
    slug character varying(120) NOT NULL,
    title character varying(255) NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    meta_title character varying(255),
    meta_description character varying(500),
    meta_keywords character varying(500),
    og_image text,
    canonical_url text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    published_at timestamp with time zone,
    show_in_menu boolean DEFAULT false NOT NULL,
    menu_order integer DEFAULT 0 NOT NULL,
    schema_type character varying(40) DEFAULT 'WebPage'::character varying NOT NULL
);

CREATE SEQUENCE public.landing_pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.landing_pages_id_seq OWNED BY public.landing_pages.id;

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    type character varying(50) DEFAULT 'info'::character varying,
    category character varying(50) DEFAULT 'system'::character varying,
    is_read boolean DEFAULT false,
    link character varying(500),
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(64) NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;

CREATE TABLE public.payments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    plan_id integer,
    amount numeric(10,2) NOT NULL,
    currency character varying(10) DEFAULT 'RUB'::character varying,
    period character varying(50),
    payment_provider character varying(50) DEFAULT 'platega'::character varying,
    provider_payment_id character varying(255),
    provider_order_id character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_url text,
    payment_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    payment_type character varying(30) DEFAULT 'subscription'::character varying NOT NULL,
    payment_source character varying(30) DEFAULT 'gateway'::character varying NOT NULL,
    wallet_transaction_id integer,
    webhook_processed_at timestamp with time zone
);

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;

CREATE TABLE public.plans (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    is_trial boolean DEFAULT false,
    traffic_gb integer NOT NULL,
    price_monthly numeric(10,2),
    price_quarterly numeric(10,2),
    price_yearly numeric(10,2),
    is_active boolean DEFAULT true,
    squad_uuids text[] DEFAULT '{}'::text[],
    features text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.plans_id_seq OWNED BY public.plans.id;

CREATE TABLE public.referral_config (
    id integer NOT NULL,
    first_payment_reward_percent numeric(5,2) DEFAULT 10.00,
    subsequent_payment_reward_percent numeric(5,2) DEFAULT 5.00,
    referral_bonus_enabled boolean DEFAULT true,
    referral_bonus_days_on_signup numeric(10,2) DEFAULT 3.00,
    referral_bonus_days_on_first_payment numeric(10,2) DEFAULT 7.00,
    referral_bonus_days_on_subsequent numeric(10,2) DEFAULT 1.00,
    min_payment_for_reward numeric(10,2) DEFAULT 100.00,
    max_monthly_reward numeric(10,2) DEFAULT 10000.00,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.referral_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.referral_config_id_seq OWNED BY public.referral_config.id;

CREATE TABLE public.referral_links (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.referral_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.referral_links_id_seq OWNED BY public.referral_links.id;

CREATE TABLE public.referral_monthly_stats (
    id integer NOT NULL,
    referrer_id integer NOT NULL,
    month date NOT NULL,
    referrals_count integer DEFAULT 0,
    new_referrals_count integer DEFAULT 0,
    total_earned numeric(10,2) DEFAULT 0,
    bonus_days_earned numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.referral_monthly_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.referral_monthly_stats_id_seq OWNED BY public.referral_monthly_stats.id;

CREATE TABLE public.referral_rewards (
    id integer NOT NULL,
    referrer_id integer NOT NULL,
    referral_id integer NOT NULL,
    payment_id integer,
    reward_type character varying(50) NOT NULL,
    amount_earned numeric(10,2) DEFAULT 0,
    bonus_days_earned numeric(10,2) DEFAULT 0,
    status character varying(50) DEFAULT 'pending'::character varying,
    credited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.referral_rewards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.referral_rewards_id_seq OWNED BY public.referral_rewards.id;

CREATE TABLE public.referrals (
    id integer NOT NULL,
    referrer_id integer NOT NULL,
    referred_user_id integer NOT NULL,
    referral_code character varying(20) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    first_payment_id integer,
    first_payment_completed_at timestamp with time zone,
    payments_count integer DEFAULT 0,
    total_referred_amount numeric(10,2) DEFAULT 0,
    total_earned numeric(10,2) DEFAULT 0,
    total_bonus_days_earned numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;
CREATE TABLE public.site_config (
    id integer NOT NULL,
    active_template_id integer,
    site_title character varying(255) DEFAULT 'VPN Webhome'::character varying,
    site_description text,
    site_logo_url character varying(512),
    site_favicon_url character varying(512),
    color_primary character varying(7) DEFAULT '#3b82f6'::character varying,
    color_secondary character varying(7) DEFAULT '#06b6d4'::character varying,
    color_accent character varying(7) DEFAULT '#f59e0b'::character varying,
    color_danger character varying(7) DEFAULT '#ef4444'::character varying,
    color_success character varying(7) DEFAULT '#10b981'::character varying,
    font_family character varying(128) DEFAULT 'Inter, sans-serif'::character varying,
    font_size_base integer DEFAULT 16,
    layout_width integer DEFAULT 1280,
    navbar_fixed boolean DEFAULT true,
    social_twitter character varying(256),
    social_github character varying(256),
    social_discord character varying(256),
    social_telegram character varying(256),
    google_analytics_id character varying(128),
    custom_css text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    project_tagline character varying(255),
    support_email character varying(255),
    support_telegram character varying(255),
    default_currency character varying(10) DEFAULT 'RUB'::character varying,
    timezone character varying(64) DEFAULT 'Europe/Moscow'::character varying,
    enable_registration boolean DEFAULT true,
    enable_payments boolean DEFAULT true,
    enable_referrals boolean DEFAULT true,
    enable_notifications boolean DEFAULT true,
    allow_trial_plan boolean DEFAULT true,
    maintenance_mode boolean DEFAULT false,
    maintenance_message text DEFAULT 'Ведутся технические работы'::text,
    require_email_confirmation boolean DEFAULT false,
    session_timeout_minutes integer DEFAULT 1440,
    max_login_attempts integer DEFAULT 5,
    remnwave_api_url character varying(512),
    remnwave_api_token text,
    remnwave_secret_key character varying(256),
    webhook_secret character varying(256),
    verify_webhooks boolean DEFAULT false
);

CREATE SEQUENCE public.site_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.site_config_id_seq OWNED BY public.site_config.id;

CREATE TABLE public.site_templates (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    html_content text DEFAULT ''::text NOT NULL,
    css_content text DEFAULT ''::text NOT NULL,
    config_data jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT false,
    is_default boolean DEFAULT false,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.site_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.site_templates_id_seq OWNED BY public.site_templates.id;

CREATE TABLE public.squads (
    id integer NOT NULL,
    uuid character varying(255) NOT NULL,
    tag character varying(255),
    display_name character varying(255),
    inbounds_count integer DEFAULT 0,
    nodes_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    synced_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.squads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.squads_id_seq OWNED BY public.squads.id;

CREATE TABLE public.subscription_traffic_snapshots (
    id bigint NOT NULL,
    subscription_id integer NOT NULL,
    user_id integer NOT NULL,
    snapshot_date date NOT NULL,
    used_bytes bigint DEFAULT 0 NOT NULL,
    limit_bytes bigint DEFAULT 0 NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.subscription_traffic_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.subscription_traffic_snapshots_id_seq OWNED BY public.subscription_traffic_snapshots.id;

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    plan_name character varying(64) NOT NULL,
    remnwave_user_uuid character varying(128),
    remnwave_username character varying(128),
    subscription_url text,
    expires_at timestamp with time zone,
    traffic_limit_gb integer DEFAULT 0,
    traffic_used_gb integer DEFAULT 0,
    squad_uuid character varying(128),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expiry_notice_sent_at timestamp with time zone
);

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    last_active_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true
);

CREATE TABLE public.user_wallets (
    user_id integer NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(10) DEFAULT 'RUB'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.users (
    id integer NOT NULL,
    login character varying(32) NOT NULL,
    email character varying(128) NOT NULL,
    password_hash character varying(128) NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    email_confirmed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pending_bonus_days numeric(10,2) DEFAULT 0,
    telegram_id bigint,
    telegram_username character varying(64)
);

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.vps_payment_history (
    id integer NOT NULL,
    vps_id integer,
    action character varying(50) DEFAULT 'renewal'::character varying,
    months integer DEFAULT 1,
    old_paid_until date,
    new_paid_until date,
    amount numeric(10,2) DEFAULT 0,
    currency character varying(10) DEFAULT 'RUB'::character varying,
    admin_user character varying(255) DEFAULT ''::character varying,
    note text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.vps_payment_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vps_payment_history_id_seq OWNED BY public.vps_payment_history.id;

CREATE TABLE public.vps_servers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    hosting_provider character varying(255) DEFAULT ''::character varying,
    ip_address character varying(45) DEFAULT ''::character varying,
    location character varying(255) DEFAULT ''::character varying,
    specs jsonb DEFAULT '{}'::jsonb,
    monthly_cost numeric(10,2) DEFAULT 0,
    currency character varying(10) DEFAULT 'RUB'::character varying,
    paid_months integer DEFAULT 1,
    paid_until date,
    node_uuid character varying(255) DEFAULT NULL::character varying,
    node_name character varying(255) DEFAULT ''::character varying,
    notes text DEFAULT ''::text,
    status character varying(50) DEFAULT 'active'::character varying,
    ssh_user character varying(100) DEFAULT 'root'::character varying,
    ssh_port integer DEFAULT 22,
    ssh_password text DEFAULT ''::text,
    ssh_key text DEFAULT ''::text,
    service_type character varying(50) DEFAULT ''::character varying,
    bbr_enabled boolean,
    ipv6_disabled boolean,
    firewall_ssh_only boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.vps_servers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vps_servers_id_seq OWNED BY public.vps_servers.id;

CREATE TABLE public.wallet_transactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character varying(30) NOT NULL,
    direction character varying(10) NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character varying(10) DEFAULT 'RUB'::character varying NOT NULL,
    balance_before numeric(12,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL,
    status character varying(30) DEFAULT 'completed'::character varying NOT NULL,
    reference_type character varying(30),
    reference_id bigint,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.wallet_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.wallet_transactions_id_seq OWNED BY public.wallet_transactions.id;

ALTER TABLE ONLY public.admin_audit_log ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_log_id_seq'::regclass);

ALTER TABLE ONLY public.admin_broadcasts ALTER COLUMN id SET DEFAULT nextval('public.admin_broadcasts_id_seq'::regclass);

ALTER TABLE ONLY public.config_history ALTER COLUMN id SET DEFAULT nextval('public.config_history_id_seq'::regclass);

ALTER TABLE ONLY public.email_verifications ALTER COLUMN id SET DEFAULT nextval('public.email_verifications_id_seq'::regclass);

ALTER TABLE ONLY public.hosting_offers_cache ALTER COLUMN id SET DEFAULT nextval('public.hosting_offers_cache_id_seq'::regclass);

ALTER TABLE ONLY public.hosting_sync_logs ALTER COLUMN id SET DEFAULT nextval('public.hosting_sync_logs_id_seq'::regclass);

ALTER TABLE ONLY public.landing_page_audit ALTER COLUMN id SET DEFAULT nextval('public.landing_page_audit_id_seq'::regclass);

ALTER TABLE ONLY public.landing_page_visits ALTER COLUMN id SET DEFAULT nextval('public.landing_page_visits_id_seq'::regclass);

ALTER TABLE ONLY public.landing_pages ALTER COLUMN id SET DEFAULT nextval('public.landing_pages_id_seq'::regclass);

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);

ALTER TABLE ONLY public.plans ALTER COLUMN id SET DEFAULT nextval('public.plans_id_seq'::regclass);

ALTER TABLE ONLY public.referral_config ALTER COLUMN id SET DEFAULT nextval('public.referral_config_id_seq'::regclass);

ALTER TABLE ONLY public.referral_links ALTER COLUMN id SET DEFAULT nextval('public.referral_links_id_seq'::regclass);

ALTER TABLE ONLY public.referral_monthly_stats ALTER COLUMN id SET DEFAULT nextval('public.referral_monthly_stats_id_seq'::regclass);

ALTER TABLE ONLY public.referral_rewards ALTER COLUMN id SET DEFAULT nextval('public.referral_rewards_id_seq'::regclass);

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);

ALTER TABLE ONLY public.site_config ALTER COLUMN id SET DEFAULT nextval('public.site_config_id_seq'::regclass);

ALTER TABLE ONLY public.site_templates ALTER COLUMN id SET DEFAULT nextval('public.site_templates_id_seq'::regclass);

ALTER TABLE ONLY public.squads ALTER COLUMN id SET DEFAULT nextval('public.squads_id_seq'::regclass);

ALTER TABLE ONLY public.subscription_traffic_snapshots ALTER COLUMN id SET DEFAULT nextval('public.subscription_traffic_snapshots_id_seq'::regclass);

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.vps_payment_history ALTER COLUMN id SET DEFAULT nextval('public.vps_payment_history_id_seq'::regclass);

ALTER TABLE ONLY public.vps_servers ALTER COLUMN id SET DEFAULT nextval('public.vps_servers_id_seq'::regclass);

ALTER TABLE ONLY public.wallet_transactions ALTER COLUMN id SET DEFAULT nextval('public.wallet_transactions_id_seq'::regclass);

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.admin_broadcasts
    ADD CONSTRAINT admin_broadcasts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.config_history
    ADD CONSTRAINT config_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hosting_offers_cache
    ADD CONSTRAINT hosting_offers_cache_offer_key_key UNIQUE (offer_key);

ALTER TABLE ONLY public.hosting_offers_cache
    ADD CONSTRAINT hosting_offers_cache_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hosting_sync_logs
    ADD CONSTRAINT hosting_sync_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.landing_page_audit
    ADD CONSTRAINT landing_page_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.landing_page_visits
    ADD CONSTRAINT landing_page_visits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.landing_pages
    ADD CONSTRAINT landing_pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.landing_pages
    ADD CONSTRAINT landing_pages_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_config
    ADD CONSTRAINT referral_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_code_key UNIQUE (code);

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.referral_monthly_stats
    ADD CONSTRAINT referral_monthly_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_monthly_stats
    ADD CONSTRAINT referral_monthly_stats_referrer_id_month_key UNIQUE (referrer_id, month);

ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_user_id_key UNIQUE (referred_user_id);
ALTER TABLE ONLY public.site_config
    ADD CONSTRAINT site_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_templates
    ADD CONSTRAINT site_templates_name_key UNIQUE (name);

ALTER TABLE ONLY public.site_templates
    ADD CONSTRAINT site_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.squads
    ADD CONSTRAINT squads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.squads
    ADD CONSTRAINT squads_uuid_key UNIQUE (uuid);

ALTER TABLE ONLY public.subscription_traffic_snapshots
    ADD CONSTRAINT subscription_traffic_snapshot_subscription_id_snapshot_date_key UNIQUE (subscription_id, snapshot_date);

ALTER TABLE ONLY public.subscription_traffic_snapshots
    ADD CONSTRAINT subscription_traffic_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_wallets
    ADD CONSTRAINT user_wallets_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_login_key UNIQUE (login);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_telegram_id_key UNIQUE (telegram_id);

ALTER TABLE ONLY public.vps_payment_history
    ADD CONSTRAINT vps_payment_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vps_servers
    ADD CONSTRAINT vps_servers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);

CREATE INDEX idx_admin_audit_action ON public.admin_audit_log USING btree (action);

CREATE INDEX idx_admin_audit_admin ON public.admin_audit_log USING btree (admin_id);

CREATE INDEX idx_admin_audit_created ON public.admin_audit_log USING btree (created_at DESC);

CREATE INDEX idx_admin_audit_target ON public.admin_audit_log USING btree (target_type, target_id);

CREATE INDEX idx_config_history_changed_by ON public.config_history USING btree (changed_by);

CREATE INDEX idx_config_history_template ON public.config_history USING btree (template_id);

CREATE INDEX idx_email_verif_email ON public.email_verifications USING btree (email);

CREATE INDEX idx_email_verif_expires ON public.email_verifications USING btree (expires_at);

CREATE INDEX idx_hosting_offers_active ON public.hosting_offers_cache USING btree (is_active);

CREATE INDEX idx_hosting_offers_price ON public.hosting_offers_cache USING btree (price_monthly);

CREATE INDEX idx_hosting_sync_logs_created_at ON public.hosting_sync_logs USING btree (created_at DESC);

CREATE INDEX idx_landing_audit_landing_time ON public.landing_page_audit USING btree (landing_id, created_at DESC);

CREATE INDEX idx_landing_pages_menu ON public.landing_pages USING btree (menu_order, id) WHERE ((is_published = true) AND (show_in_menu = true));

CREATE INDEX idx_landing_pages_published_slug ON public.landing_pages USING btree (slug) WHERE (is_published = true);

CREATE INDEX idx_landing_pages_updated_at ON public.landing_pages USING btree (updated_at DESC);

CREATE INDEX idx_landing_visits_landing_time ON public.landing_page_visits USING btree (landing_id, visited_at DESC);

CREATE INDEX idx_landing_visits_time ON public.landing_page_visits USING btree (visited_at);

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);

CREATE INDEX idx_password_reset_token ON public.password_reset_tokens USING btree (token);

CREATE INDEX idx_password_reset_user ON public.password_reset_tokens USING btree (user_id);

CREATE INDEX idx_payments_provider_order_id ON public.payments USING btree (provider_order_id);

CREATE INDEX idx_payments_status ON public.payments USING btree (status);

CREATE INDEX idx_payments_user_id ON public.payments USING btree (user_id);

CREATE INDEX idx_plans_active ON public.plans USING btree (is_active);

CREATE INDEX idx_referral_links_code ON public.referral_links USING btree (code);

CREATE INDEX idx_referral_links_user_id ON public.referral_links USING btree (user_id);

CREATE INDEX idx_referral_rewards_referrer_id ON public.referral_rewards USING btree (referrer_id);

CREATE INDEX idx_referral_rewards_status ON public.referral_rewards USING btree (status);

CREATE INDEX idx_referrals_referred_user_id ON public.referrals USING btree (referred_user_id);

CREATE INDEX idx_referrals_referrer_id ON public.referrals USING btree (referrer_id);

CREATE INDEX idx_referrals_status ON public.referrals USING btree (status);

CREATE INDEX idx_sessions_expires ON public.user_sessions USING btree (expires_at);

CREATE INDEX idx_sessions_token_hash ON public.user_sessions USING btree (token_hash);

CREATE INDEX idx_sessions_user_id ON public.user_sessions USING btree (user_id);

CREATE INDEX idx_site_templates_active ON public.site_templates USING btree (is_active);

CREATE INDEX idx_site_templates_default ON public.site_templates USING btree (is_default);

CREATE INDEX idx_squads_active ON public.squads USING btree (is_active);

CREATE INDEX idx_squads_uuid ON public.squads USING btree (uuid);

CREATE INDEX idx_subscriptions_expires ON public.subscriptions USING btree (expires_at);

CREATE INDEX idx_subscriptions_user_active ON public.subscriptions USING btree (user_id, is_active);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);

CREATE INDEX idx_traffic_snapshots_sub ON public.subscription_traffic_snapshots USING btree (subscription_id, snapshot_date DESC);

CREATE INDEX idx_traffic_snapshots_user ON public.subscription_traffic_snapshots USING btree (user_id, snapshot_date DESC);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_login ON public.users USING btree (login);

CREATE INDEX idx_users_telegram_id ON public.users USING btree (telegram_id);

CREATE INDEX idx_wallet_transactions_reference ON public.wallet_transactions USING btree (reference_type, reference_id);

CREATE INDEX idx_wallet_transactions_user_id ON public.wallet_transactions USING btree (user_id);

CREATE UNIQUE INDEX uq_payments_provider_payment_id ON public.payments USING btree (provider_payment_id) WHERE (provider_payment_id IS NOT NULL);

CREATE TRIGGER referral_config_updated_at BEFORE UPDATE ON public.referral_config FOR EACH ROW EXECUTE FUNCTION public.update_referral_config_updated_at();

CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.update_referrals_updated_at();

CREATE TRIGGER update_landing_pages_updated_at BEFORE UPDATE ON public.landing_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.admin_broadcasts
    ADD CONSTRAINT admin_broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.config_history
    ADD CONSTRAINT config_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.config_history
    ADD CONSTRAINT config_history_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.site_templates(id);

ALTER TABLE ONLY public.landing_page_audit
    ADD CONSTRAINT landing_page_audit_landing_id_fkey FOREIGN KEY (landing_id) REFERENCES public.landing_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.landing_page_audit
    ADD CONSTRAINT landing_page_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.landing_page_visits
    ADD CONSTRAINT landing_page_visits_landing_id_fkey FOREIGN KEY (landing_id) REFERENCES public.landing_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.landing_pages
    ADD CONSTRAINT landing_pages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_wallet_transaction_id_fkey FOREIGN KEY (wallet_transaction_id) REFERENCES public.wallet_transactions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.referral_links
    ADD CONSTRAINT referral_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_monthly_stats
    ADD CONSTRAINT referral_monthly_stats_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_first_payment_id_fkey FOREIGN KEY (first_payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referral_code_fkey FOREIGN KEY (referral_code) REFERENCES public.referral_links(code) ON DELETE RESTRICT;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_config
    ADD CONSTRAINT site_config_active_template_id_fkey FOREIGN KEY (active_template_id) REFERENCES public.site_templates(id);

ALTER TABLE ONLY public.site_templates
    ADD CONSTRAINT site_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.subscription_traffic_snapshots
    ADD CONSTRAINT subscription_traffic_snapshots_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscription_traffic_snapshots
    ADD CONSTRAINT subscription_traffic_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_wallets
    ADD CONSTRAINT user_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.vps_payment_history
    ADD CONSTRAINT vps_payment_history_vps_id_fkey FOREIGN KEY (vps_id) REFERENCES public.vps_servers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
--

-- ============================================================
-- SEED DATA — начальная конфигурация для свежей установки.
-- На существующих БД эти INSERT-ы не сработают благодаря ON CONFLICT DO NOTHING.
-- ============================================================

-- Тарифные планы по умолчанию
INSERT INTO plans (name, description, is_trial, traffic_gb, price_monthly, price_quarterly, price_yearly, squad_uuids, features) VALUES
  ('Free Trial', 'Бесплатный пробный период на 7 дней', true, 10, NULL, NULL, NULL, ARRAY['5466bd3e-4ca9-4658-80ef-2e0101e297ae']::TEXT[], ARRAY['10 GB трафика', '7 дней доступа', 'Базовая скорость']::TEXT[]),
  ('Базовый', 'Отличный выбор для начинающих', false, 50, 299, 799, 2999, ARRAY['5466bd3e-4ca9-4658-80ef-2e0101e297ae', 'e5edc973-24f6-446d-af50-11339dc85304']::TEXT[], ARRAY['50 GB трафика', 'Высокая скорость', 'Поддержка 24/7']::TEXT[]),
  ('Премиум', 'Максимальная скорость и безопасность', false, 200, 599, 1599, 5999, ARRAY['e5edc973-24f6-446d-af50-11339dc85304', 'f38d4138-5f40-461e-8807-9f4abb7cfe1b']::TEXT[], ARRAY['200 GB трафика', 'Максимальная скорость', 'Приоритетная поддержка', 'Выделенные серверы']::TEXT[]),
  ('Безлимитный', 'Безлимитный трафик для профессионалов', false, 999999, 999, 2699, 9999, ARRAY['e5edc973-24f6-446d-af50-11339dc85304', 'f38d4138-5f40-461e-8807-9f4abb7cfe1b', 'cadd6ecd-e84f-4234-830d-67d73127156f']::TEXT[], ARRAY['Безлимитный трафик', 'Максимальная скорость', 'VIP поддержка', 'Все серверы', 'Приоритетный доступ']::TEXT[])
ON CONFLICT DO NOTHING;

-- Конфигурация реферальной программы (одна запись)
INSERT INTO referral_config (
  first_payment_reward_percent,
  subsequent_payment_reward_percent,
  referral_bonus_enabled,
  referral_bonus_days_on_signup,
  referral_bonus_days_on_first_payment,
  referral_bonus_days_on_subsequent
) VALUES (10.00, 5.00, true, 3.00, 7.00, 1.00)
ON CONFLICT DO NOTHING;

-- Дефолтный шаблон сайта
INSERT INTO site_templates (name, description, is_active, is_default, html_content, css_content)
VALUES (
  'Default Modern',
  'Современный минималистичный шаблон с голубым акцентом',
  true, true,
  '<div class="hero"><h1>VPN Webhome</h1><p>Быстрый и надежный VPN сервис</p></div>',
  'body { font-family: Inter, sans-serif; background: #0f172a; color: #e2e8f0; }
   .hero { text-align: center; padding: 100px 20px; }'
)
ON CONFLICT (name) DO NOTHING;

-- Глобальная конфигурация сайта
INSERT INTO site_config (active_template_id)
SELECT id FROM site_templates WHERE is_default = true LIMIT 1
ON CONFLICT DO NOTHING;
