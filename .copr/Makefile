# COPR entry point (T41): build the source RPM that COPR will rebuild offline.
# COPR does not guarantee the current directory, so locate the script from here.
srpm:
	$(dir $(lastword $(MAKEFILE_LIST)))copr-srpm.sh $(outdir)
