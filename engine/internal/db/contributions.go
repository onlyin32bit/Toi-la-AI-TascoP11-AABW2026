package db

import (
	"context"
	"database/sql"
	"errors"
)

// SetContributionOwner attaches (or reassigns) a UGC contributor identity to
// a contribution (POI id from contributions.json, e.g. "ugc:1a2b3c4d").
// userID nil = anonymous, still recorded so the row exists.
func (d *DB) SetContributionOwner(ctx context.Context, contributionID string, userID *string) error {
	_, err := d.sql.ExecContext(ctx,
		`INSERT INTO contribution_owners (contribution_id, user_id) VALUES ($1,$2)
		 ON CONFLICT (contribution_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
		contributionID, userID)
	return err
}

// ContributionOwner returns the owning user id, or nil if anonymous/unset.
func (d *DB) ContributionOwner(ctx context.Context, contributionID string) (*string, error) {
	var userID *string
	row := d.sql.QueryRowContext(ctx,
		`SELECT user_id FROM contribution_owners WHERE contribution_id=$1`, contributionID)
	if err := row.Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return userID, nil
}
