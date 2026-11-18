# Static Website

A Pulumi component that provisions a public **S3 website bucket** and uploads a
single index document. It bundles the bucket, website configuration, ownership
controls, public-access settings, the public-read bucket policy, and the index
object so callers don't repeat that boilerplate.

## Usage

```ts
import { StaticWebsite } from "@pulumi-pequod/static-website";

const site = new StaticWebsite("app-site", {
    content: renderedHtml,   // string / Output<string>
});

export const siteUrl = site.url;
```

## Inputs

| Name            | Type          | Required | Description |
| --------------- | ------------- | -------- | ----------- |
| `content`       | `string`      | yes      | Contents of the index document. |
| `indexDocument` | `string`      | no       | Index document key (default `"index.html"`). |
| `contentType`   | `string`      | no       | Content type (default `"text/html"`). |
| `tags`          | `map<string>` | no       | Tags applied to the bucket. |

## Outputs

| Name              | Type     | Description |
| ----------------- | -------- | ----------- |
| `url`             | `string` | URL of the index document via the bucket's regional domain. |
| `websiteEndpoint` | `string` | The S3 static website hosting endpoint. |
| `bucketName`      | `string` | The bucket name. |
