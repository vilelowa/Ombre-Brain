#!/usr/bin/env python3
"""Backfill source metadata for existing Ombre Brain buckets."""

from bucket_manager import BucketManager
from utils import load_config


def main() -> None:
    config = load_config()
    bucket_mgr = BucketManager(config)
    migrated = bucket_mgr.migrate_missing_sources()
    print(f"Migrated {migrated} bucket source field(s).")


if __name__ == "__main__":
    main()
