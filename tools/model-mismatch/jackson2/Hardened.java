import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.type.LogicalType;
import java.nio.file.*;
import java.util.List;

/** The same cases against a Jackson 2 mapper hardened to reject what Pydantic and Zod reject. */
public class Hardened {
    public record Order(@JsonProperty(required = true) long id,
                        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
                        String note,
                        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> tags) {}

    public static void main(String[] args) throws Exception {
        JsonMapper mapper = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .build();
        mapper.coercionConfigFor(LogicalType.Integer).setCoercion(CoercionInputShape.String, CoercionAction.Fail);
        mapper.coercionConfigFor(LogicalType.Textual).setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
        JsonNode cases = mapper.readTree(Files.readString(Path.of("../cases.json")));
        for (JsonNode c : cases) {
            String result;
            try {
                result = "OK " + mapper.treeToValue(c.get(1), Order.class);
            } catch (Exception e) {
                result = "ERROR " + e.getClass().getSimpleName();
            }
            System.out.println(c.get(0).asText() + "\t" + result);
        }
    }
}
