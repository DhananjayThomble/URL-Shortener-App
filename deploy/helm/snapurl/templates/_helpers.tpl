{{/*
Standard Helm helpers for the snapurl chart.
*/}}

{{/* The base name, overridable with nameOverride. */}}
{{- define "snapurl.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* The fully qualified app name (release-scoped), overridable with fullnameOverride. */}}
{{- define "snapurl.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* chart name + version, for the helm.sh/chart label. */}}
{{- define "snapurl.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels applied to every object. */}}
{{- define "snapurl.labels" -}}
helm.sh/chart: {{ include "snapurl.chart" . }}
{{ include "snapurl.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: snapurl
{{- end -}}

{{/* Selector labels shared by the whole release. */}}
{{- define "snapurl.selectorLabels" -}}
app.kubernetes.io/name: {{ include "snapurl.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component labels. Call with a dict: (dict "root" . "component" "api").
Includes the common labels plus the component label so api/redirect/worker
objects are distinguishable while still sharing the release labels.
*/}}
{{- define "snapurl.componentLabels" -}}
{{- $root := .root -}}
{{ include "snapurl.labels" $root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Per-component selector labels. Call with (dict "root" . "component" "api").
These are the immutable selector keys a Deployment/Service/PDB matches on.
*/}}
{{- define "snapurl.componentSelectorLabels" -}}
{{- $root := .root -}}
{{ include "snapurl.selectorLabels" $root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* The ServiceAccount name to use. */}}
{{- define "snapurl.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "snapurl.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The name of the Secret holding credentials. Returns existingSecret when set,
else the chart-managed Secret name.
*/}}
{{- define "snapurl.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "snapurl.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* The ConfigMap name holding non-secret env. */}}
{{- define "snapurl.configMapName" -}}
{{- printf "%s-config" (include "snapurl.fullname" .) -}}
{{- end -}}

{{/*
Compose the image ref for a component. Call with:
  (dict "root" . "component" "api")
Uses the per-service repository/tag override when set, else the global
registry + repositoryPrefix + component + global tag.
*/}}
{{- define "snapurl.image" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $svc := index $root.Values $component -}}
{{- $globalTag := $root.Values.image.tag -}}
{{- if and $svc $svc.image $svc.image.repository -}}
{{- $tag := default $globalTag $svc.image.tag -}}
{{- printf "%s:%s" $svc.image.repository $tag -}}
{{- else -}}
{{- $tag := $globalTag -}}
{{- if and $svc $svc.image $svc.image.tag -}}
{{- $tag = $svc.image.tag -}}
{{- end -}}
{{- printf "%s/%s%s:%s" $root.Values.image.registry $root.Values.image.repositoryPrefix $component $tag -}}
{{- end -}}
{{- end -}}
