-- Fixed demo zones (hand-drawn, like a user would on the map). Coordinates lon/lat.
create table if not exists geo.demo_zone (id text primary key, label text, geom geometry(Polygon,4269));
insert into geo.demo_zone values ('oakland_flats','Oakland flatlands, drawn by hand',
 ST_GeomFromText('POLYGON((-122.322 37.806,-122.296 37.836,-122.262 37.836,-122.240 37.815,-122.205 37.790,-122.185 37.770,-122.200 37.752,-122.232 37.765,-122.265 37.790,-122.300 37.795,-122.322 37.806))',4269))
on conflict (id) do update set geom = excluded.geom, label = excluded.label;
