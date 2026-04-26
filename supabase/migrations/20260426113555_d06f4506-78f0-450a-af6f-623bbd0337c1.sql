create or replace function public.generate_game_pin()
returns trigger language plpgsql security definer set search_path = public as $$
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