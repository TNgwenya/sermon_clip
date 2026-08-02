# Durable sermon source ingestion on AWS S3

SermonClip treats a private S3 object as the durable source of truth for every
uploaded sermon recording. The browser uploads multipart parts directly to S3
through short-lived presigned URLs. The media worker later streams the completed
object to its local processing disk, validates its byte count and media duration,
and then runs FFmpeg and transcription.

YouTube URLs remain supported as a best-effort import path. They are not the
durable source-of-truth path because YouTube may require cookies, bot checks, or
per-video proof tokens.

## Bucket requirements

- Keep Block Public Access enabled.
- Use default S3 server-side encryption. The application also requests `AES256`
  encryption when initiating each multipart upload.
- Configure a lifecycle rule with `AbortIncompleteMultipartUpload` after one day.
  Do not add an automatic deletion rule for completed source objects.
- Configure CORS with the exact production application origins. Example:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["https://your-sermonclip.example"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## EC2 instance-role permissions

Attach a least-privilege policy to the EC2 instance role. Replace the example
bucket name before applying it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListMultipartSourceParts",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::YOUR_PRIVATE_SOURCE_BUCKET"
    },
    {
      "Sid": "ManageSermonSourceObjects",
      "Effect": "Allow",
      "Action": [
        "s3:AbortMultipartUpload",
        "s3:GetObject",
        "s3:ListMultipartUploadParts",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_PRIVATE_SOURCE_BUCKET/sermon-sources/*"
    }
  ]
}
```

Do not add AWS access keys to `.env`. The AWS SDK uses the EC2 instance role.

## Runtime configuration

```dotenv
SOURCE_MEDIA_S3_BUCKET=YOUR_PRIVATE_SOURCE_BUCKET
SOURCE_MEDIA_S3_REGION=eu-central-1
SOURCE_MEDIA_S3_KEY_PREFIX=sermon-sources
SOURCE_MEDIA_S3_PART_SIZE_MIB=16
SOURCE_MEDIA_S3_PRESIGN_TTL_SECONDS=900
```

The same values must be present in the web process that signs upload parts and
the media worker that restores completed sources.

## Processing behavior

1. `initiate` creates a tenant-bound `SermonSourceAsset` and S3 multipart upload.
2. The browser uploads up to four independent parts concurrently.
3. A repeated upload resumes by listing the parts already accepted by S3.
4. `complete` validates every part number and byte count before completing S3.
5. The database marks the asset `READY` and queues `PROCESS_SERMON`.
6. The worker downloads to a partial local file, validates it, atomically promotes
   it to `source.mp4`, and records the detected duration.
7. If local media is later removed, processing restores the same durable object
   instead of downloading the video from YouTube again.
