// Fail-fast validation for security-critical env vars.
//
// Called once at process start (server.js) so a misconfigured deployment
// crashes immediately and loudly instead of silently signing tokens with
// a weak/default secret.

const MIN_JWT_SECRET_LENGTH = 32;

function validateEnv() {
  const errors = [];

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    errors.push('JWT_SECRET is not set. Generate one with: openssl rand -hex 32');
  } else if (secret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET is too short (${secret.length} chars; need ≥ ${MIN_JWT_SECRET_LENGTH}).`
    );
  } else if (secret === 'devsecret' || secret === 'changeme' || secret === 'change-this') {
    errors.push('JWT_SECRET is a known placeholder. Set a real random secret.');
  }

  if (!process.env.MONGO_URI) {
    errors.push('MONGO_URI is not set.');
  }

  if (errors.length > 0) {
    console.error('\n❌  Environment validation failed:');
    for (const e of errors) console.error('   - ' + e);
    console.error(
      '\n   Set the missing values in your .env or compose env block, then restart.\n'
    );
    process.exit(1);
  }
}

module.exports = { validateEnv };
