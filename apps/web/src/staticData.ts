// Static data files the frontend reads directly, not through the scenario
// API: the three PMTiles archives (buildings/debris/municipalities) and
// faults.json (ADR-0022). All live under `tiles/` in the public data bucket
// (ADR-0016). Deployed builds set just VITE_S3_DATA_BUCKET (the stack's
// `DataBucketName` output); unset, local dev serves them from
// apps/web/public/data instead. The region is hardcoded rather than a
// second env var: it must match the stack's region (infra/, deployed to
// eu-south-2), and eu-south-2 is an opt-in region -- S3's region-less
// `<bucket>.s3.amazonaws.com` endpoint 400s for it, so the URL can't just
// leave it out.
const S3_DATA_BUCKET_REGION = "eu-south-2";

// The deployed stack's DataBucketName (docs/deploy-cloudflare.md).
const DEPLOYED_DATA_BUCKET = "twinr-mvp-databuckete3889a50-qnfinvnljqx9";

function s3TilesUrl(bucket: string, path: string): string {
  return `https://${bucket}.s3.${S3_DATA_BUCKET_REGION}.amazonaws.com/tiles/${path}`;
}

export function staticDataUrl(filename: string): string {
  const bucket = import.meta.env.VITE_S3_DATA_BUCKET;
  return bucket ? s3TilesUrl(bucket, filename) : `/data/${filename}`;
}

// The self-hosted basemap (ADR-0028) is read from S3 even in local dev:
// it's a 21GB extract that nothing local needs a copy of, and it doesn't
// change with the local dataset. The bucket's CORS rule allows
// http://localhost:5173 (infra/stacks/twiner_stack.py FRONTEND_ORIGINS).
export function basemapDataUrl(path: string): string {
  return s3TilesUrl(import.meta.env.VITE_S3_DATA_BUCKET || DEPLOYED_DATA_BUCKET, `basemap/${path}`);
}
