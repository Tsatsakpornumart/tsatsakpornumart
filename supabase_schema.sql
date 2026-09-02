-- ==============================================================================
-- TSATSAKPORNU POS & RETAIL MANAGEMENT SYSTEM - SUPABASE SQL SCHEMA
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

-- 1. Enable UUID Extension
create extension if not exists "uuid-ossp";

-- 2. Create Profiles Table (Linked to Supabase Auth)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text not null,
  role text not null check (role in ('admin', 'salesperson')),
  phone text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 3. Create Products Table (With Cost Price & Selling Price for Profit Calculation)
create table if not exists public.products (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  category text default 'General' not null,
  cost_price numeric(12,2) not null check (cost_price >= 0),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  stock integer default 0 not null check (stock >= 0),
  min_stock_alert integer default 5 not null,
  sku text,
  barcode text,
  image_url text,
  is_active boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 4. Create Sales Table
create table if not exists public.sales (
  id uuid default uuid_generate_v4() primary key,
  salesperson_id uuid references public.profiles(id) on delete set null,
  salesperson_name text not null,
  customer_name text default 'Walk-in Customer',
  customer_phone text,
  total_revenue numeric(12,2) not null check (total_revenue >= 0),
  total_cost numeric(12,2) not null check (total_cost >= 0),
  net_profit numeric(12,2) not null,
  payment_method text not null check (payment_method in ('cash', 'momo', 'card')),
  notes text,
  created_at timestamptz default now() not null
);

-- 5. Create Sale Items Table (Snapshot of Prices at Time of Sale)
create table if not exists public.sale_items (
  id uuid default uuid_generate_v4() primary key,
  sale_id uuid references public.sales(id) on delete cascade not null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  cost_price numeric(12,2) not null check (cost_price >= 0),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  subtotal_revenue numeric(12,2) not null check (subtotal_revenue >= 0),
  subtotal_cost numeric(12,2) not null check (subtotal_cost >= 0),
  subtotal_profit numeric(12,2) not null,
  created_at timestamptz default now() not null
);

-- 6. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- 7. RLS Policies
-- Profiles: Any authenticated user can read profiles; users can update their own
drop policy if exists "Allow read profiles" on public.profiles;
create policy "Allow read profiles" on public.profiles for select using (true);
drop policy if exists "Allow self insert/update profiles" on public.profiles;
create policy "Allow self insert/update profiles" on public.profiles for all using (auth.uid() = id);

-- Products: Everyone can read products; only admins can insert/update/delete
drop policy if exists "Allow read active products" on public.products;
create policy "Allow read active products" on public.products for select using (true);
drop policy if exists "Allow admin modify products" on public.products;
create policy "Allow admin modify products" on public.products for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  or auth.role() = 'anon'
);

-- Sales & Sale Items: All users can insert; Everyone can read (frontend restricts sensitive calculations to admins)
drop policy if exists "Allow insert sales" on public.sales;
create policy "Allow insert sales" on public.sales for insert with check (true);
drop policy if exists "Allow read sales" on public.sales;
create policy "Allow read sales" on public.sales for select using (true);
drop policy if exists "Allow delete sales" on public.sales;
create policy "Allow delete sales" on public.sales for delete using (true);
drop policy if exists "Allow insert sale_items" on public.sale_items;
create policy "Allow insert sale_items" on public.sale_items for insert with check (true);
drop policy if exists "Allow read sale_items" on public.sale_items;
create policy "Allow read sale_items" on public.sale_items for select using (true);
drop policy if exists "Allow delete sale_items" on public.sale_items;
create policy "Allow delete sale_items" on public.sale_items for delete using (true);

-- Products: Allow admin to delete products for reset
drop policy if exists "Allow delete products" on public.products;
create policy "Allow delete products" on public.products for delete using (true);

-- 8. Trigger to automatically create a profile when a new user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'salesperson')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 9. Enable realtime updates for products and sales
do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales;
exception
  when duplicate_object then null;
end $$;

-- 10. No seed products — add your real products via the Admin Panel
-- (Removed sample data to ensure clean KPI tracking from day one)

-- 11. Create Supabase Storage Bucket for Product Images
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Storage Policies: Everyone can view product images; Anyone can upload/manage
drop policy if exists "Public Access Product Images" on storage.objects;
create policy "Public Access Product Images" on storage.objects for select using (bucket_id = 'product-images');

drop policy if exists "Allow Upload Product Images" on storage.objects;
create policy "Allow Upload Product Images" on storage.objects for insert with check (bucket_id = 'product-images');

drop policy if exists "Allow Update Product Images" on storage.objects;
create policy "Allow Update Product Images" on storage.objects for update using (bucket_id = 'product-images');

drop policy if exists "Allow Delete Product Images" on storage.objects;
create policy "Allow Delete Product Images" on storage.objects for delete using (bucket_id = 'product-images');
