import { z } from "zod";

const envSchema = z
  .object({
    // Server config
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    HOST: z.string().default("localhost"),
    PORT: z.coerce.number().default(3000),

    // OAuth providers
    ALLOWED_DOMAINS: z
      .string()
      .optional()
      .default("localhost,cajuinasaogeraldo.com.br"),

    // GitHub
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GITHUB_HOSTNAME: z.string().default("github.com"),

    // GitLab
    GITLAB_CLIENT_ID: z.string().optional(),
    GITLAB_CLIENT_SECRET: z.string().optional(),
    GITLAB_HOSTNAME: z.string().default("gitlab.com"),

    // Bitbucket
    BITBUCKET_CLIENT_ID: z.string().optional(),
    BITBUCKET_CLIENT_SECRET: z.string().optional(),
    BITBUCKET_HOSTNAME: z.string().default("bitbucket.com"),

    // Security
    INSECURE_COOKIES: z.string().default("0"),

    // Logging
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
  })
  .refine(
    (env) => {
      const hasGitHub = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET;
      const hasGitLab = env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET;
      const hasBitbucket =
        env.BITBUCKET_CLIENT_ID && env.BITBUCKET_CLIENT_SECRET;
      return hasGitHub || hasGitLab || hasBitbucket;
    },
    {
      message:
        "At least one OAuth provider must be configured (GitHub, GitLab, or Bitbucket)",
    }
  );

export type EnvType = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
