# COPR entry point (T41): build the source RPM that COPR will rebuild offline.
# COPR does not guarantee the current directory, so locate the script from the
# Makefile's own location (it lives in scripts/, one level up from here).
SRPM_SCRIPT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../scripts/copr-srpm.sh)

srpm:
	$(SRPM_SCRIPT) $(outdir)
