-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quizzes
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.quizzes enable row level security;

create policy "Quizzes viewable by everyone" on public.quizzes for select using (true);
create policy "Hosts insert own quizzes" on public.quizzes for insert with check (auth.uid() = host_id);
create policy "Hosts update own quizzes" on public.quizzes for update using (auth.uid() = host_id);
create policy "Hosts delete own quizzes" on public.quizzes for delete using (auth.uid() = host_id);

-- Questions
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_text text not null,
  image_url text,
  time_limit int not null default 20,
  points int not null default 1000,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.questions enable row level security;

create policy "Questions viewable by everyone" on public.questions for select using (true);
create policy "Hosts insert questions for own quiz" on public.questions for insert
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.host_id = auth.uid()));
create policy "Hosts update questions for own quiz" on public.questions for update
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.host_id = auth.uid()));
create policy "Hosts delete questions for own quiz" on public.questions for delete
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.host_id = auth.uid()));

-- Answers
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_text text not null,
  is_correct boolean not null default false,
  color_index int not null default 0,
  order_index int not null default 0
);
alter table public.answers enable row level security;

create policy "Answers viewable by everyone" on public.answers for select using (true);
create policy "Hosts insert answers for own quiz" on public.answers for insert
  with check (exists (
    select 1 from public.questions qu join public.quizzes q on q.id = qu.quiz_id
    where qu.id = question_id and q.host_id = auth.uid()
  ));
create policy "Hosts update answers for own quiz" on public.answers for update
  using (exists (
    select 1 from public.questions qu join public.quizzes q on q.id = qu.quiz_id
    where qu.id = question_id and q.host_id = auth.uid()
  ));
create policy "Hosts delete answers for own quiz" on public.answers for delete
  using (exists (
    select 1 from public.questions qu join public.quizzes q on q.id = qu.quiz_id
    where qu.id = question_id and q.host_id = auth.uid()
  ));

-- Game Sessions
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  pin text not null unique,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby', -- lobby, active, question, reveal, finished
  current_question_index int not null default 0,
  question_started_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.game_sessions enable row level security;

create policy "Sessions viewable by everyone" on public.game_sessions for select using (true);
create policy "Hosts create own sessions" on public.game_sessions for insert with check (auth.uid() = host_id);
create policy "Hosts update own sessions" on public.game_sessions for update using (auth.uid() = host_id);
create policy "Hosts delete own sessions" on public.game_sessions for delete using (auth.uid() = host_id);

-- PIN generator
create or replace function public.generate_game_pin()
returns trigger language plpgsql as $$
declare
  new_pin text;
  attempts int := 0;
begin
  if new.pin is null or new.pin = '' then
    loop
      new_pin := lpad(floor(random() * 1000000)::text, 6, '0');
      exit when not exists (select 1 from public.game_sessions where pin = new_pin);
      attempts := attempts + 1;
      if attempts > 20 then
        raise exception 'Could not generate unique PIN';
      end if;
    end loop;
    new.pin := new_pin;
  end if;
  return new;
end;
$$;

create trigger set_game_pin
  before insert on public.game_sessions
  for each row execute function public.generate_game_pin();

-- Players (no auth required)
create table public.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  nickname text not null,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  unique (session_id, nickname)
);
alter table public.players enable row level security;

create policy "Players viewable by everyone" on public.players for select using (true);
create policy "Anyone can join a session" on public.players for insert with check (true);
create policy "Anyone can update player score" on public.players for update using (true);

-- Player answers
create table public.player_answers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_id uuid references public.answers(id) on delete set null,
  response_time_ms int not null default 0,
  points_awarded int not null default 0,
  created_at timestamptz not null default now(),
  unique (player_id, question_id)
);
alter table public.player_answers enable row level security;

create policy "Player answers viewable by everyone" on public.player_answers for select using (true);
create policy "Anyone can submit answer" on public.player_answers for insert with check (true);

-- Realtime
alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.player_answers;
alter table public.game_sessions replica identity full;
alter table public.players replica identity full;
alter table public.player_answers replica identity full;