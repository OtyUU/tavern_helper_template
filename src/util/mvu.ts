export function defineMvuDataStore<T extends z.ZodObject>(
  schema: T,
  variable_option: VariableOption,
  additional_setup?: (data: Ref<z.infer<T>>) => void,
): ReturnType<typeof defineStore> {
  if (
    variable_option.type === 'message' &&
    (variable_option.message_id === undefined || variable_option.message_id === 'latest')
  ) {
    variable_option.message_id = -1;
  }

  return defineStore(
    `mvu_data.${_(variable_option)
      .entries()
      .sortBy(entry => entry[0])
      .map(entry => entry[1])
      .join('.')}`,
    () => {
      // Parse initial data, using defaults if parsing fails
      const stat_data = _.get(getVariables(variable_option), 'stat_data', {});
      const parse_result = schema.safeParse(stat_data);

      if (parse_result.error) {
        console.warn('Failed to parse initial MVU data, using defaults:', parse_result.error);
        console.warn('Input data was:', stat_data);
      }

      const data = ref(parse_result.success ? parse_result.data : schema.parse({})) as Ref<z.infer<T>>;

      if (additional_setup) {
        try {
          additional_setup(data);
        } catch (error) {
          console.error('Error in additional_setup:', error);
          toastr.error(`MVU store setup error: ${error}`);
        }
      }

      useIntervalFn(() => {
        const stat_data = _.get(getVariables(variable_option), 'stat_data', {});
        const result = schema.safeParse(stat_data);
        if (result.error) {
          return;
        }
        if (!_.isEqual(data.value, result.data)) {
          ignoreUpdates(() => {
            data.value = result.data;
          });
        }
        if (!_.isEqual(stat_data, result.data)) {
          updateVariablesWith(variables => _.set(variables, 'stat_data', result.data), variable_option);
        }
      }, 2000);

      const { ignoreUpdates } = watchIgnorable(
        data,
        new_data => {
          const result = schema.safeParse(new_data);
          if (result.error) {
            return;
          }
          if (!_.isEqual(new_data, result.data)) {
            ignoreUpdates(() => {
              data.value = result.data;
            });
          }
          updateVariablesWith(variables => _.set(variables, 'stat_data', result.data), variable_option);
        },
        { deep: true },
      );

      return { data };
    },
  );
}
