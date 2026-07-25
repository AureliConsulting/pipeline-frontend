-- Private artifact storage.
-- Layout: artifacts/<user_id>/<run_id>/<stage>/<file_name>
-- The first path segment is the owner's auth.uid(), which the SELECT policy
-- enforces. There are NO insert/update/delete policies for authenticated:
-- every upload happens through server routes (service role) that verify run
-- ownership and generate short-lived signed upload/download URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artifacts',
  'artifacts',
  false,
  52428800, -- 50 MB, matches protocol.limits.max_csv_upload_bytes
  array['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/json',
        'application/x-yaml', 'text/yaml', 'application/octet-stream', 'text/markdown']
)
on conflict (id) do nothing;

create policy "artifacts: owners read own folder"
on storage.objects for select to authenticated
using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
